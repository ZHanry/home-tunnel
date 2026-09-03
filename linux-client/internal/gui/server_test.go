package gui

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestHandlerPingAndIndex(t *testing.T) {
	server := New(Options{StatePath: filepath.Join(t.TempDir(), "state.json")})
	handler := server.Handler()

	index := httptest.NewRequest(http.MethodGet, "/", nil)
	indexRec := httptest.NewRecorder()
	handler.ServeHTTP(indexRec, index)
	if indexRec.Code != http.StatusOK {
		t.Fatalf("index status %d", indexRec.Code)
	}
	body, _ := io.ReadAll(indexRec.Body)
	if !strings.Contains(string(body), "Home Tunnel") {
		t.Fatal("index page missing title")
	}

	ping := httptest.NewRequest(http.MethodGet, "/local/ping", nil)
	pingRec := httptest.NewRecorder()
	handler.ServeHTTP(pingRec, ping)
	if pingRec.Code != http.StatusOK {
		t.Fatalf("ping status %d", pingRec.Code)
	}
}

func TestStateWithoutEnrollment(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "state.json")
	server := New(Options{StatePath: statePath})
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/local/state", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["enrolled"] != false {
		t.Fatalf("enrolled = %v", payload["enrolled"])
	}
}

func TestConnectionsRequireLogin(t *testing.T) {
	server := New(Options{StatePath: filepath.Join(t.TempDir(), "missing.json")})
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/local/connections", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d", rec.Code)
	}
}

func TestLogoutClearsStateAfterStop(t *testing.T) {
	dir := t.TempDir()
	statePath := filepath.Join(dir, "state.json")
	if err := os.WriteFile(statePath, []byte(`{"install_id":"11111111-1111-4111-8111-111111111111"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	runtimeDir := filepath.Join(dir, "runtime")
	if err := os.MkdirAll(runtimeDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(runtimeDir, "keep.txt"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	server := New(Options{StatePath: statePath})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/local/logout", nil)
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(statePath); !os.IsNotExist(err) {
		t.Fatalf("state still present: %v", err)
	}
	if _, err := os.Stat(runtimeDir); !os.IsNotExist(err) {
		t.Fatalf("runtime still present: %v", err)
	}
}

func TestShowInvokesCallback(t *testing.T) {
	server := New(Options{StatePath: filepath.Join(t.TempDir(), "state.json")})
	called := make(chan struct{}, 1)
	server.SetShow(func() { called <- struct{}{} })
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/local/show", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	select {
	case <-called:
	case <-time.After(2 * time.Second):
		t.Fatal("show callback was not invoked")
	}
}

func TestQuitInvokesCallbackAfterStop(t *testing.T) {
	server := New(Options{StatePath: filepath.Join(t.TempDir(), "state.json")})
	called := make(chan struct{}, 1)
	server.SetQuit(func() { called <- struct{}{} })
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/local/quit", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	select {
	case <-called:
	case <-time.After(2 * time.Second):
		t.Fatal("quit callback was not scheduled")
	}
}

func TestStopAgentWhenIdle(t *testing.T) {
	server := New(Options{StatePath: filepath.Join(t.TempDir(), "state.json")})
	server.StopAgent()
}

func TestConnectionItemRejectsUnknownID(t *testing.T) {
	server := New(Options{StatePath: filepath.Join(t.TempDir(), "missing.json")})
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/local/connections/missing", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d", rec.Code)
	}
}
