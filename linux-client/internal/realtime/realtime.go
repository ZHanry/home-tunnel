// Package realtime implements the minimal RFC 6455 WebSocket client used to
// receive control-center push events without third-party dependencies. It
// supports exactly what the server emits: unfragmented text messages up to
// 64 KiB plus ping/pong/close control frames. Fragmented messages (FIN=0)
// are rejected as a protocol error: the server's ws library never splits the
// small JSON events it sends, and leaving reassembly out of scope keeps this
// frame layer small and auditable.
package realtime

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha1"
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/ZHanry/home-tunnel/linux-client/internal/model"
)

const (
	websocketGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
	// maximumFramePayload mirrors the server's maxPayload of 64 KiB; a larger
	// frame indicates a broken or hostile peer and aborts the connection.
	maximumFramePayload = 64 * 1024
	// defaultIdleTimeout bounds how long ReadEvent waits for any frame. The
	// server sends a protocol ping every 30 seconds, so 90 seconds of silence
	// means the connection is half-open and must be re-established.
	defaultIdleTimeout = 90 * time.Second
	handshakeTimeout   = 15 * time.Second
	writeTimeout       = 10 * time.Second
)

const (
	opcodeContinuation = 0x0
	opcodeText         = 0x1
	opcodeBinary       = 0x2
	opcodeClose        = 0x8
	opcodePing         = 0x9
	opcodePong         = 0xA
)

// ErrUnauthorized reports that the control center rejected the bearer token
// during the upgrade handshake (HTTP 401); callers must re-authenticate.
var ErrUnauthorized = errors.New("realtime session is unauthorized")

// StatusError is returned when the upgrade handshake receives a well-formed
// HTTP response with a status other than 101 Switching Protocols.
type StatusError struct {
	StatusCode int
}

func (err *StatusError) Error() string {
	return fmt.Sprintf("websocket handshake failed (HTTP %d)", err.StatusCode)
}

// Unwrap maps 401 responses to ErrUnauthorized so callers can detect revoked
// or expired sessions with errors.Is.
func (err *StatusError) Unwrap() error {
	if err.StatusCode == http.StatusUnauthorized {
		return ErrUnauthorized
	}
	return nil
}

// Conn is a client WebSocket connection. ReadEvent must be used from one
// goroutine at a time; writes are serialized internally, so Close and the
// automatic pong replies may run concurrently with a blocked read.
type Conn struct {
	conn        net.Conn
	reader      *bufio.Reader
	idleTimeout time.Duration

	writeMu   sync.Mutex
	closeSent bool

	closeOnce sync.Once
	closeErr  error
}

// Dial connects to the control-center realtime endpoint derived from the
// REST API base URL, following the same relative-path convention as the API
// client: the trailing-slash base ".../api/v1/" resolves to ".../api/v1/ws".
// An https or wss base is dialed through TLS with tlsConfig (nil selects the
// platform defaults); an http or ws base uses plain TCP so httptest-backed
// test servers remain reachable.
func Dial(ctx context.Context, apiBaseURL, bearerToken string, tlsConfig *tls.Config) (*Conn, error) {
	endpoint, secure, err := deriveEndpoint(apiBaseURL)
	if err != nil {
		return nil, err
	}
	netDialer := &net.Dialer{Timeout: handshakeTimeout}
	var socket net.Conn
	if secure {
		tlsDialer := &tls.Dialer{NetDialer: netDialer, Config: tlsConfig}
		socket, err = tlsDialer.DialContext(ctx, "tcp", dialAddress(endpoint, secure))
	} else {
		socket, err = netDialer.DialContext(ctx, "tcp", dialAddress(endpoint, secure))
	}
	if err != nil {
		return nil, fmt.Errorf("connect realtime endpoint: %w", err)
	}
	connection, err := completeHandshake(ctx, socket, endpoint, bearerToken)
	if err != nil {
		_ = socket.Close()
		return nil, err
	}
	return connection, nil
}

func deriveEndpoint(apiBaseURL string) (*url.URL, bool, error) {
	parsed, err := url.Parse(apiBaseURL)
	if err != nil || !parsed.IsAbs() || parsed.Host == "" {
		return nil, false, errors.New("realtime base URL must be an absolute URL")
	}
	var secure bool
	switch strings.ToLower(parsed.Scheme) {
	case "https", "wss":
		secure = true
	case "http", "ws":
		secure = false
	default:
		return nil, false, fmt.Errorf("realtime base URL has unsupported scheme %q", parsed.Scheme)
	}
	return parsed.ResolveReference(&url.URL{Path: "ws"}), secure, nil
}

func dialAddress(endpoint *url.URL, secure bool) string {
	if endpoint.Port() != "" {
		return endpoint.Host
	}
	port := "80"
	if secure {
		port = "443"
	}
	return net.JoinHostPort(endpoint.Hostname(), port)
}

func completeHandshake(ctx context.Context, socket net.Conn, endpoint *url.URL, bearerToken string) (*Conn, error) {
	deadline := time.Now().Add(handshakeTimeout)
	if ctxDeadline, ok := ctx.Deadline(); ok && ctxDeadline.Before(deadline) {
		deadline = ctxDeadline
	}
	if err := socket.SetDeadline(deadline); err != nil {
		return nil, err
	}
	watcherStop := make(chan struct{})
	var watcher sync.WaitGroup
	watcher.Add(1)
	go func() {
		defer watcher.Done()
		select {
		case <-ctx.Done():
			// Force the blocked handshake write/read to fail immediately.
			_ = socket.SetDeadline(time.Unix(1, 0))
		case <-watcherStop:
		}
	}()
	reader := bufio.NewReaderSize(socket, 4096)
	err := exchangeHandshake(socket, reader, endpoint, bearerToken)
	close(watcherStop)
	watcher.Wait()
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil {
		return nil, err
	}
	if err := socket.SetDeadline(time.Time{}); err != nil {
		return nil, err
	}
	return &Conn{conn: socket, reader: reader, idleTimeout: defaultIdleTimeout}, nil
}

func exchangeHandshake(socket net.Conn, reader *bufio.Reader, endpoint *url.URL, bearerToken string) error {
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return fmt.Errorf("generate websocket key: %w", err)
	}
	key := base64.StdEncoding.EncodeToString(nonce)
	var request strings.Builder
	request.WriteString("GET " + endpoint.RequestURI() + " HTTP/1.1\r\n")
	request.WriteString("Host: " + endpoint.Host + "\r\n")
	request.WriteString("Upgrade: websocket\r\n")
	request.WriteString("Connection: Upgrade\r\n")
	request.WriteString("Sec-WebSocket-Key: " + key + "\r\n")
	request.WriteString("Sec-WebSocket-Version: 13\r\n")
	request.WriteString("Authorization: Bearer " + bearerToken + "\r\n")
	request.WriteString("User-Agent: HomeTunnel-Linux/" + model.Version + "\r\n\r\n")
	if _, err := io.WriteString(socket, request.String()); err != nil {
		return fmt.Errorf("send websocket handshake: %w", err)
	}
	// The same buffered reader keeps serving frame reads afterwards, so any
	// websocket bytes the server sent right after its response are not lost.
	response, err := http.ReadResponse(reader, nil)
	if err != nil {
		return fmt.Errorf("read websocket handshake response: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusSwitchingProtocols {
		return &StatusError{StatusCode: response.StatusCode}
	}
	if !strings.EqualFold(response.Header.Get("Upgrade"), "websocket") {
		return errors.New("server did not upgrade the connection to websocket")
	}
	if response.Header.Get("Sec-WebSocket-Accept") != acceptKey(key) {
		return errors.New("server returned a mismatched Sec-WebSocket-Accept value")
	}
	return nil
}

// acceptKey derives the RFC 6455 Sec-WebSocket-Accept value. SHA-1 is what
// the protocol mandates here; it is a handshake checksum, not a security
// boundary.
func acceptKey(key string) string {
	digest := sha1.Sum([]byte(key + websocketGUID))
	return base64.StdEncoding.EncodeToString(digest[:])
}

// ReadEvent returns the next text message. Control frames are handled
// internally: pings are answered with matching pongs, pongs only reset the
// idle timer, and a close frame is acknowledged before an io.EOF-wrapping
// error is returned. Binary messages are ignored because the control center
// only sends text events. The call aborts when ctx is cancelled or when no
// frame at all arrives within the idle timeout.
func (connection *Conn) ReadEvent(ctx context.Context) ([]byte, error) {
	watcherStop := make(chan struct{})
	var watcher sync.WaitGroup
	watcher.Add(1)
	go func() {
		defer watcher.Done()
		select {
		case <-ctx.Done():
			// Unblock the pending read immediately; the loop below maps the
			// resulting timeout back to ctx.Err().
			_ = connection.conn.SetReadDeadline(time.Unix(1, 0))
		case <-watcherStop:
		}
	}()
	defer func() {
		close(watcherStop)
		watcher.Wait()
	}()
	for {
		if err := connection.conn.SetReadDeadline(time.Now().Add(connection.idleTimeout)); err != nil {
			return nil, err
		}
		if err := ctx.Err(); err != nil {
			// Checked after arming the deadline so a cancellation racing the
			// SetReadDeadline above can never leave a long blocking read.
			return nil, err
		}
		fin, opcode, payload, err := connection.readFrame()
		if err != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return nil, ctxErr
			}
			return nil, err
		}
		switch opcode {
		case opcodeText:
			if !fin {
				return nil, errors.New("fragmented websocket messages are not supported")
			}
			return payload, nil
		case opcodeBinary:
			// Ignored; a fragmented binary message still fails on the
			// continuation frame that follows it.
		case opcodePing:
			if err := connection.WritePong(payload); err != nil {
				return nil, fmt.Errorf("answer websocket ping: %w", err)
			}
		case opcodePong:
			// Receiving any frame already reset the idle deadline.
		case opcodeClose:
			_ = connection.writeFrame(opcodeClose, closeAcknowledgement(payload))
			return nil, fmt.Errorf("server closed the websocket%s: %w", closeDetail(payload), io.EOF)
		case opcodeContinuation:
			return nil, errors.New("fragmented websocket messages are not supported")
		default:
			return nil, fmt.Errorf("unsupported websocket opcode %#x", opcode)
		}
	}
}

func (connection *Conn) readFrame() (bool, byte, []byte, error) {
	var header [2]byte
	if _, err := io.ReadFull(connection.reader, header[:]); err != nil {
		return false, 0, nil, fmt.Errorf("read websocket frame: %w", err)
	}
	if header[0]&0x70 != 0 {
		return false, 0, nil, errors.New("websocket frame uses unsupported reserved bits")
	}
	fin := header[0]&0x80 != 0
	opcode := header[0] & 0x0f
	if header[1]&0x80 != 0 {
		return false, 0, nil, errors.New("server-to-client websocket frames must not be masked")
	}
	length := uint64(header[1] & 0x7f)
	switch length {
	case 126:
		var extended [2]byte
		if _, err := io.ReadFull(connection.reader, extended[:]); err != nil {
			return false, 0, nil, fmt.Errorf("read websocket frame length: %w", err)
		}
		length = uint64(binary.BigEndian.Uint16(extended[:]))
	case 127:
		var extended [8]byte
		if _, err := io.ReadFull(connection.reader, extended[:]); err != nil {
			return false, 0, nil, fmt.Errorf("read websocket frame length: %w", err)
		}
		length = binary.BigEndian.Uint64(extended[:])
	}
	if isControlOpcode(opcode) && (!fin || length > 125) {
		return false, 0, nil, errors.New("websocket control frame is fragmented or oversized")
	}
	if length > maximumFramePayload {
		return false, 0, nil, fmt.Errorf("websocket frame of %d bytes exceeds the %d byte limit", length, maximumFramePayload)
	}
	payload := make([]byte, int(length))
	if _, err := io.ReadFull(connection.reader, payload); err != nil {
		return false, 0, nil, fmt.Errorf("read websocket payload: %w", err)
	}
	return fin, opcode, payload, nil
}

func isControlOpcode(opcode byte) bool {
	return opcode >= opcodeClose
}

// closeAcknowledgement echoes only the two-byte status code of a received
// close frame, as RFC 6455 recommends for the closing handshake reply.
func closeAcknowledgement(payload []byte) []byte {
	if len(payload) >= 2 {
		return payload[:2]
	}
	return nil
}

func closeDetail(payload []byte) string {
	if len(payload) < 2 {
		return ""
	}
	code := binary.BigEndian.Uint16(payload)
	reason := strings.TrimSpace(string(payload[2:]))
	if reason == "" {
		return fmt.Sprintf(" (code %d)", code)
	}
	return fmt.Sprintf(" (code %d: %s)", code, reason)
}

// WriteText sends a text message, e.g. the application-level "ping".
func (connection *Conn) WriteText(payload []byte) error {
	return connection.writeFrame(opcodeText, payload)
}

// WritePong answers a ping; ReadEvent already does this automatically.
func (connection *Conn) WritePong(payload []byte) error {
	return connection.writeFrame(opcodePong, payload)
}

// WriteClose sends a close frame with the given status code and reason; the
// reason is truncated to fit the 125-byte control-frame payload limit.
func (connection *Conn) WriteClose(code uint16, reason string) error {
	if len(reason) > 123 {
		reason = reason[:123]
	}
	payload := make([]byte, 2+len(reason))
	binary.BigEndian.PutUint16(payload, code)
	copy(payload[2:], reason)
	return connection.writeFrame(opcodeClose, payload)
}

// Close performs a best-effort close handshake and releases the connection.
func (connection *Conn) Close() error {
	connection.closeOnce.Do(func() {
		_ = connection.WriteClose(1000, "")
		connection.closeErr = connection.conn.Close()
	})
	return connection.closeErr
}

// writeFrame writes one complete frame. Client-to-server frames are always
// masked with a fresh crypto/rand key as RFC 6455 requires; at most one close
// frame is ever sent.
func (connection *Conn) writeFrame(opcode byte, payload []byte) error {
	if len(payload) > maximumFramePayload {
		return fmt.Errorf("websocket payload of %d bytes exceeds the %d byte limit", len(payload), maximumFramePayload)
	}
	connection.writeMu.Lock()
	defer connection.writeMu.Unlock()
	if opcode == opcodeClose {
		if connection.closeSent {
			return nil
		}
		connection.closeSent = true
	}
	var maskKey [4]byte
	if _, err := rand.Read(maskKey[:]); err != nil {
		return fmt.Errorf("generate websocket mask: %w", err)
	}
	frame := make([]byte, 0, 14+len(payload))
	frame = append(frame, 0x80|opcode)
	switch {
	case len(payload) <= 125:
		frame = append(frame, 0x80|byte(len(payload)))
	case len(payload) <= 0xffff:
		frame = append(frame, 0x80|126, byte(len(payload)>>8), byte(len(payload)))
	default:
		frame = append(frame, 0x80|127)
		var extended [8]byte
		binary.BigEndian.PutUint64(extended[:], uint64(len(payload)))
		frame = append(frame, extended[:]...)
	}
	frame = append(frame, maskKey[:]...)
	start := len(frame)
	frame = append(frame, payload...)
	for index := range payload {
		frame[start+index] ^= maskKey[index%4]
	}
	if err := connection.conn.SetWriteDeadline(time.Now().Add(writeTimeout)); err != nil {
		return err
	}
	_, err := connection.conn.Write(frame)
	return err
}
