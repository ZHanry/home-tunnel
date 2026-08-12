package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	statepkg "github.com/ZHanry/home-tunnel/linux-client/internal/state"
)

func TestEnrollPersistsDeviceCredentialWithoutPassword(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/public/config":
			_ = json.NewEncoder(response).Encode(map[string]any{
				"public_base_url": server.URL,
				"tunnel_domain":   "tunnel.example.com",
				"frps_host":       "frps.example.com",
				"frps_port":       7000,
			})
		case "/api/v1/auth/login":
			_ = json.NewEncoder(response).Encode(map[string]any{
				"access_token": "access-token", "refresh_token": "refresh-token",
				"access_expires_at": time.Now().Add(time.Hour), "password_change_required": false,
			})
		case "/api/v1/devices/register":
			if request.Header.Get("Authorization") != "Bearer access-token" {
				http.Error(response, `{"error_code":"AUTH_INVALID","message":"missing token"}`, http.StatusUnauthorized)
				return
			}
			response.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(response).Encode(map[string]any{
				"device_id":         "11111111-2222-4333-8444-555555555555",
				"device_credential": "persistent-device-credential", "config_version": 1,
			})
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()
	statePath := filepath.Join(t.TempDir(), "state.json")
	if err := Enroll(context.Background(), EnrollOptions{
		StatePath: statePath, Server: server.URL, Username: "user", Password: "account-password",
		DeviceName: "linux-test", HTTPClient: server.Client(),
	}); err != nil {
		t.Fatal(err)
	}
	state, err := (statepkg.Store{Path: statePath}).Load()
	if err != nil {
		t.Fatal(err)
	}
	if state.DeviceCredential != "persistent-device-credential" || !state.Enrolled() {
		t.Fatalf("unexpected enrolled state: %#v", state)
	}
	data, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "account-password") || strings.Contains(string(data), "access-token") || strings.Contains(string(data), "refresh-token") {
		t.Fatal("state persisted an account password or session token")
	}
}
