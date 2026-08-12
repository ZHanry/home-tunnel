package realtime

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAcceptKeyMatchesRFC6455Example(t *testing.T) {
	if accept := acceptKey("dGhlIHNhbXBsZSBub25jZQ=="); accept != "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=" {
		t.Fatalf("acceptKey = %q", accept)
	}
}

func TestDialReadsTextEventsAndIgnoresBinary(t *testing.T) {
	server := startWebsocketServer(t, func(conn net.Conn, _ *bufio.Reader) {
		_, _ = conn.Write(serverFrame(opcodeBinary, []byte{1, 2, 3}, true))
		_, _ = conn.Write(serverFrame(opcodeText, []byte(`{"event":"realtime.connected"}`), true))
	})
	connection := dialTest(t, server.URL)
	defer connection.Close()
	message, err := connection.ReadEvent(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if string(message) != `{"event":"realtime.connected"}` {
		t.Fatalf("message = %q", message)
	}
}

func TestDialReportsHandshakeStatusErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") == "Bearer expired-token" {
			response.WriteHeader(http.StatusUnauthorized)
			return
		}
		response.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()
	if _, err := Dial(context.Background(), server.URL+"/api/v1/", "expired-token", nil); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("401 must map to ErrUnauthorized, got %v", err)
	}
	_, err := Dial(context.Background(), server.URL+"/api/v1/", "other-token", nil)
	var status *StatusError
	if !errors.As(err, &status) || status.StatusCode != http.StatusServiceUnavailable || errors.Is(err, ErrUnauthorized) {
		t.Fatalf("unexpected status error: %v", err)
	}
}

func TestDialRejectsMismatchedAcceptKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		conn, _ := hijackAndAccept(t, response, "an-invalid-accept-value")
		if conn != nil {
			_ = conn.Close()
		}
	}))
	defer server.Close()
	if _, err := Dial(context.Background(), server.URL+"/api/v1/", "test-token", nil); err == nil || !strings.Contains(err.Error(), "Sec-WebSocket-Accept") {
		t.Fatalf("mismatched accept key must be rejected, got %v", err)
	}
}

func TestPingIsAnsweredWithPongAutomatically(t *testing.T) {
	replies := make(chan clientFrame, 1)
	server := startWebsocketServer(t, func(conn net.Conn, reader *bufio.Reader) {
		_, _ = conn.Write(serverFrame(opcodePing, []byte("keepalive"), true))
		replies <- readClientFrame(reader)
		_, _ = conn.Write(serverFrame(opcodeText, []byte("done"), true))
	})
	connection := dialTest(t, server.URL)
	defer connection.Close()
	message, err := connection.ReadEvent(context.Background())
	if err != nil || string(message) != "done" {
		t.Fatalf("message=%q err=%v", message, err)
	}
	reply := <-replies
	if reply.err != nil || reply.opcode != opcodePong || string(reply.payload) != "keepalive" {
		t.Fatalf("pong reply = %+v", reply)
	}
}

func TestWriteTextFramesAreMaskedOnTheWire(t *testing.T) {
	received := make(chan clientFrame, 1)
	server := startWebsocketServer(t, func(conn net.Conn, reader *bufio.Reader) {
		received <- readClientFrame(reader)
		_, _ = conn.Write(serverFrame(opcodeText, []byte("pong"), true))
	})
	connection := dialTest(t, server.URL)
	defer connection.Close()
	if err := connection.WriteText([]byte("ping")); err != nil {
		t.Fatal(err)
	}
	if message, err := connection.ReadEvent(context.Background()); err != nil || string(message) != "pong" {
		t.Fatalf("message=%q err=%v", message, err)
	}
	// readClientFrame fails on unmasked frames and unmasks the payload, so a
	// matching payload proves the mask key was generated and applied.
	frame := <-received
	if frame.err != nil || frame.opcode != opcodeText || string(frame.payload) != "ping" {
		t.Fatalf("client frame = %+v", frame)
	}
}

func TestOversizedFrameAbortsConnection(t *testing.T) {
	server := startWebsocketServer(t, func(conn net.Conn, _ *bufio.Reader) {
		_, _ = conn.Write(serverFrame(opcodeText, make([]byte, maximumFramePayload+1), true))
	})
	connection := dialTest(t, server.URL)
	defer connection.Close()
	if _, err := connection.ReadEvent(context.Background()); err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("oversized frame must abort the read, got %v", err)
	}
}

func TestServerCloseIsAcknowledgedAndSurfacesEOF(t *testing.T) {
	closePayload := make([]byte, 2+len("server shutdown"))
	binary.BigEndian.PutUint16(closePayload, 1001)
	copy(closePayload[2:], "server shutdown")
	acknowledgements := make(chan clientFrame, 1)
	server := startWebsocketServer(t, func(conn net.Conn, reader *bufio.Reader) {
		_, _ = conn.Write(serverFrame(opcodeClose, closePayload, true))
		acknowledgements <- readClientFrame(reader)
	})
	connection := dialTest(t, server.URL)
	defer connection.Close()
	if _, err := connection.ReadEvent(context.Background()); !errors.Is(err, io.EOF) {
		t.Fatalf("close frame must surface an io.EOF-wrapping error, got %v", err)
	}
	acknowledgement := <-acknowledgements
	if acknowledgement.err != nil || acknowledgement.opcode != opcodeClose {
		t.Fatalf("close acknowledgement = %+v", acknowledgement)
	}
	if len(acknowledgement.payload) != 2 || binary.BigEndian.Uint16(acknowledgement.payload) != 1001 {
		t.Fatalf("close acknowledgement must echo status 1001, got % x", acknowledgement.payload)
	}
}

func TestFragmentedMessagesAreRejected(t *testing.T) {
	server := startWebsocketServer(t, func(conn net.Conn, _ *bufio.Reader) {
		_, _ = conn.Write(serverFrame(opcodeText, []byte("part"), false))
	})
	connection := dialTest(t, server.URL)
	defer connection.Close()
	if _, err := connection.ReadEvent(context.Background()); err == nil || !strings.Contains(err.Error(), "fragmented") {
		t.Fatalf("fragmented message must be rejected, got %v", err)
	}
}

func TestReadEventStopsOnContextCancel(t *testing.T) {
	holdOpen := make(chan struct{})
	defer close(holdOpen)
	server := startWebsocketServer(t, func(net.Conn, *bufio.Reader) {
		<-holdOpen
	})
	connection := dialTest(t, server.URL)
	defer connection.Close()
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()
	started := time.Now()
	if _, err := connection.ReadEvent(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
	if time.Since(started) > 5*time.Second {
		t.Fatal("context cancellation did not unblock the read promptly")
	}
}

func TestReadEventFailsAfterIdleTimeout(t *testing.T) {
	holdOpen := make(chan struct{})
	defer close(holdOpen)
	server := startWebsocketServer(t, func(net.Conn, *bufio.Reader) {
		<-holdOpen
	})
	connection := dialTest(t, server.URL)
	defer connection.Close()
	connection.idleTimeout = 100 * time.Millisecond
	_, err := connection.ReadEvent(context.Background())
	var netErr net.Error
	if !errors.As(err, &netErr) || !netErr.Timeout() {
		t.Fatalf("expected a timeout error after idle silence, got %v", err)
	}
}

func TestDialOverTLS(t *testing.T) {
	server := httptest.NewTLSServer(websocketHandler(t, func(conn net.Conn, _ *bufio.Reader) {
		_, _ = conn.Write(serverFrame(opcodeText, []byte("secure"), true))
	}))
	defer server.Close()
	transport, ok := server.Client().Transport.(*http.Transport)
	if !ok {
		t.Fatal("unexpected httptest transport type")
	}
	connection, err := Dial(context.Background(), server.URL+"/api/v1/", "test-token", transport.TLSClientConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	if message, err := connection.ReadEvent(context.Background()); err != nil || string(message) != "secure" {
		t.Fatalf("message=%q err=%v", message, err)
	}
}

// --- test server helpers -------------------------------------------------

func dialTest(t *testing.T, serverURL string) *Conn {
	t.Helper()
	connection, err := Dial(context.Background(), serverURL+"/api/v1/", "test-token", nil)
	if err != nil {
		t.Fatal(err)
	}
	return connection
}

// startWebsocketServer runs an httptest server whose /api/v1/ws endpoint is
// upgraded manually; script runs in the handler goroutine with the raw
// connection once the 101 response has been written.
func startWebsocketServer(t *testing.T, script func(conn net.Conn, reader *bufio.Reader)) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(websocketHandler(t, script))
	t.Cleanup(server.Close)
	return server
}

func websocketHandler(t *testing.T, script func(conn net.Conn, reader *bufio.Reader)) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v1/ws" {
			http.NotFound(response, request)
			return
		}
		if request.Header.Get("Sec-WebSocket-Version") != "13" || !strings.EqualFold(request.Header.Get("Upgrade"), "websocket") {
			t.Errorf("missing websocket upgrade headers: %v", request.Header)
		}
		if request.Header.Get("Authorization") != "Bearer test-token" {
			response.WriteHeader(http.StatusUnauthorized)
			return
		}
		conn, reader := hijackAndAccept(t, response, acceptKey(request.Header.Get("Sec-WebSocket-Key")))
		if conn == nil {
			return
		}
		defer conn.Close()
		script(conn, reader)
	})
}

func hijackAndAccept(t *testing.T, response http.ResponseWriter, accept string) (net.Conn, *bufio.Reader) {
	t.Helper()
	hijacker, ok := response.(http.Hijacker)
	if !ok {
		t.Error("response writer does not support hijacking")
		return nil, nil
	}
	conn, buffered, err := hijacker.Hijack()
	if err != nil {
		t.Errorf("hijack websocket request: %v", err)
		return nil, nil
	}
	header := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
	if _, err := conn.Write([]byte(header)); err != nil {
		t.Errorf("write handshake response: %v", err)
		_ = conn.Close()
		return nil, nil
	}
	return conn, buffered.Reader
}

// serverFrame builds a raw unmasked server-to-client frame.
func serverFrame(opcode byte, payload []byte, fin bool) []byte {
	first := opcode
	if fin {
		first |= 0x80
	}
	frame := []byte{first}
	switch {
	case len(payload) <= 125:
		frame = append(frame, byte(len(payload)))
	case len(payload) <= 0xffff:
		frame = append(frame, 126, byte(len(payload)>>8), byte(len(payload)))
	default:
		frame = append(frame, 127)
		var extended [8]byte
		binary.BigEndian.PutUint64(extended[:], uint64(len(payload)))
		frame = append(frame, extended[:]...)
	}
	return append(frame, payload...)
}

type clientFrame struct {
	opcode  byte
	payload []byte
	err     error
}

// readClientFrame parses one client-to-server frame, requires the mask bit,
// and returns the unmasked payload.
func readClientFrame(reader io.Reader) clientFrame {
	header := make([]byte, 2)
	if _, err := io.ReadFull(reader, header); err != nil {
		return clientFrame{err: err}
	}
	if header[1]&0x80 == 0 {
		return clientFrame{err: errors.New("client frame is not masked")}
	}
	length := int(header[1] & 0x7f)
	switch length {
	case 126:
		extended := make([]byte, 2)
		if _, err := io.ReadFull(reader, extended); err != nil {
			return clientFrame{err: err}
		}
		length = int(binary.BigEndian.Uint16(extended))
	case 127:
		extended := make([]byte, 8)
		if _, err := io.ReadFull(reader, extended); err != nil {
			return clientFrame{err: err}
		}
		length = int(binary.BigEndian.Uint64(extended))
	}
	mask := make([]byte, 4)
	if _, err := io.ReadFull(reader, mask); err != nil {
		return clientFrame{err: err}
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(reader, payload); err != nil {
		return clientFrame{err: err}
	}
	for index := range payload {
		payload[index] ^= mask[index%4]
	}
	return clientFrame{opcode: header[0] & 0x0f, payload: payload}
}
