package app

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ZHanry/home-tunnel/linux-client/internal/api"
)

// Run itself needs a real agent binary (supervisor.Apply spawns it), so the
// realtime integration is exercised at the runRealtimeLoop level: it covers
// token acquisition, event-to-signal fan-in, re-login and revocation exits.
// The main-loop select case simply mirrors the existing poll-ticker case.

func TestRunRealtimeLoopSignalsSynchronization(t *testing.T) {
	businessEvent := `{"event":"config.version.changed","resource_type":"device_config","resource_id":"rc","resource_version":7,"payload":{"device_id":"device-1"},"at":"2026-08-12T00:00:00Z"}`
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/auth/device":
			writeTestSession(response, "ws-access")
		case "/api/v1/ws":
			if request.Header.Get("Authorization") != "Bearer ws-access" {
				response.WriteHeader(http.StatusUnauthorized)
				return
			}
			conn, reader := hijackTestWebsocket(t, response, request)
			if conn == nil {
				return
			}
			defer conn.Close()
			writeTestWebsocketText(t, conn, `{"event":"realtime.connected","at":"2026-08-12T00:00:00Z"}`)
			writeTestWebsocketText(t, conn, businessEvent)
			// Hold the connection open until the client disconnects.
			_, _ = io.Copy(io.Discard, reader)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	client := newRealtimeTestClient(t, server)
	signals := make(chan struct{}, 1)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		runRealtimeLoop(ctx, realtimeTestOptions(server, client, signals))
	}()

	select {
	case <-signals:
	case <-time.After(10 * time.Second):
		t.Error("realtime event did not trigger a synchronization signal")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Error("realtime loop did not stop after context cancellation")
	}
}

func TestRunRealtimeLoopReloginAfterUnauthorized(t *testing.T) {
	var logins atomic.Int32
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/auth/device":
			writeTestSession(response, fmt.Sprintf("ws-access-%d", logins.Add(1)))
		case "/api/v1/ws":
			// Only the token from the second device login is accepted, so
			// the first connection attempt exercises the re-login path.
			if request.Header.Get("Authorization") != "Bearer ws-access-2" {
				response.WriteHeader(http.StatusUnauthorized)
				return
			}
			conn, reader := hijackTestWebsocket(t, response, request)
			if conn == nil {
				return
			}
			defer conn.Close()
			writeTestWebsocketText(t, conn, `{"event":"realtime.connected","at":"2026-08-12T00:00:00Z"}`)
			writeTestWebsocketText(t, conn, `{"event":"connection.command","payload":{"device_id":"device-1"},"at":"2026-08-12T00:00:00Z"}`)
			_, _ = io.Copy(io.Discard, reader)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	client := newRealtimeTestClient(t, server)
	signals := make(chan struct{}, 1)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		runRealtimeLoop(ctx, realtimeTestOptions(server, client, signals))
	}()

	select {
	case <-signals:
	case <-time.After(10 * time.Second):
		t.Error("realtime loop did not recover from an unauthorized handshake")
	}
	if count := logins.Load(); count != 2 {
		t.Errorf("device logins = %d, want 2 (enrollment plus one re-login)", count)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Error("realtime loop did not stop after context cancellation")
	}
}

func TestRunRealtimeLoopStopsWhenDeviceRevoked(t *testing.T) {
	var logins atomic.Int32
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/auth/device":
			if logins.Add(1) == 1 {
				writeTestSession(response, "ws-access")
				return
			}
			http.Error(response, `{"error_code":"DEVICE_REVOKED","message":"device was revoked"}`, http.StatusForbidden)
		case "/api/v1/ws":
			response.WriteHeader(http.StatusUnauthorized)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	client := newRealtimeTestClient(t, server)
	signals := make(chan struct{}, 1)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		runRealtimeLoop(ctx, realtimeTestOptions(server, client, signals))
	}()

	// The loop must stop on its own (without a context cancellation) once the
	// re-login reports a revoked device.
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("realtime loop did not stop after the device was revoked")
	}
	select {
	case <-signals:
	default:
		t.Error("revocation must schedule one final synchronization for the main loop")
	}
}

// --- test helpers ---------------------------------------------------------

func newRealtimeTestClient(t *testing.T, server *httptest.Server) *api.Client {
	t.Helper()
	client, err := api.New(server.URL+"/api/v1/", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.DeviceLogin(context.Background(), "device-1", "credential"); err != nil {
		t.Fatal(err)
	}
	return client
}

func realtimeTestOptions(server *httptest.Server, client *api.Client, signals chan struct{}) realtimeLoopOptions {
	return realtimeLoopOptions{
		client:           client,
		apiBaseURL:       server.URL + "/api/v1/",
		deviceID:         "device-1",
		deviceCredential: "credential",
		tlsConfig:        tlsConfigFromHTTPClient(server.Client()),
		signals:          signals,
	}
}

func writeTestSession(response http.ResponseWriter, accessToken string) {
	_ = json.NewEncoder(response).Encode(map[string]any{
		"access_token": accessToken, "refresh_token": accessToken + "-refresh",
		"access_expires_at": time.Now().Add(time.Hour),
	})
}

func hijackTestWebsocket(t *testing.T, response http.ResponseWriter, request *http.Request) (net.Conn, *bufio.Reader) {
	t.Helper()
	hijacker, ok := response.(http.Hijacker)
	if !ok {
		t.Error("test server cannot hijack the websocket request")
		return nil, nil
	}
	conn, buffered, err := hijacker.Hijack()
	if err != nil {
		t.Errorf("hijack websocket request: %v", err)
		return nil, nil
	}
	digest := sha1.Sum([]byte(request.Header.Get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	header := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + base64.StdEncoding.EncodeToString(digest[:]) + "\r\n\r\n"
	if _, err := conn.Write([]byte(header)); err != nil {
		t.Errorf("write websocket handshake response: %v", err)
		_ = conn.Close()
		return nil, nil
	}
	return conn, buffered.Reader
}

// writeTestWebsocketText writes a raw unmasked server-to-client text frame.
func writeTestWebsocketText(t *testing.T, conn net.Conn, payload string) {
	t.Helper()
	frame := []byte{0x81}
	switch {
	case len(payload) <= 125:
		frame = append(frame, byte(len(payload)))
	default:
		frame = append(frame, 126, byte(len(payload)>>8), byte(len(payload)))
	}
	frame = append(frame, payload...)
	if _, err := conn.Write(frame); err != nil {
		t.Errorf("write websocket frame: %v", err)
	}
}
