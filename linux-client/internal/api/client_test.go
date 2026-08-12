package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestDiscoverAcceptsSameOriginProfile(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v1/public/config" {
			http.NotFound(response, request)
			return
		}
		_ = json.NewEncoder(response).Encode(map[string]any{
			"public_base_url": server.URL,
			"tunnel_domain":   "tunnel.example.com",
			"frps_host":       "frps.example.com",
			"frps_port":       7000,
		})
	}))
	defer server.Close()
	profile, err := Discover(context.Background(), server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if profile.APIBaseURL != server.URL+"/api/v1/" || profile.FRPSPort != 7000 {
		t.Fatalf("unexpected profile: %#v", profile)
	}
	if profile.FRPSTLSCertificatePEM != "" {
		t.Fatalf("profile without a served certificate must stay empty: %#v", profile)
	}
}

func TestDiscoverParsesOptionalFrpsTlsCertificate(t *testing.T) {
	pem := "-----BEGIN CERTIFICATE-----\ntest-only-frps-ca\n-----END CERTIFICATE-----\n"
	responses := map[string]string{"valid": pem, "invalid": "not-a-pem"}
	for name, served := range responses {
		t.Run(name, func(t *testing.T) {
			var server *httptest.Server
			server = httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				_ = json.NewEncoder(response).Encode(map[string]any{
					"public_base_url":          server.URL,
					"tunnel_domain":            "tunnel.example.com",
					"frps_host":                "frps.example.com",
					"frps_port":                7000,
					"frps_tls_certificate_pem": served,
				})
			}))
			defer server.Close()
			profile, err := Discover(context.Background(), server.URL, server.Client())
			if name == "valid" {
				if err != nil {
					t.Fatal(err)
				}
				if profile.FRPSTLSCertificatePEM != pem {
					t.Fatalf("certificate PEM not preserved: %#v", profile)
				}
				return
			}
			if err == nil {
				t.Fatal("invalid FRPS certificate PEM was accepted")
			}
		})
	}
}

func TestLinuxLoginAndRefreshPayloads(t *testing.T) {
	var loginType string
	var refreshType string
	var protectedCalls atomic.Int32
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/auth/login":
			var body map[string]any
			_ = json.NewDecoder(request.Body).Decode(&body)
			loginType, _ = body["client_type"].(string)
			_ = json.NewEncoder(response).Encode(map[string]any{
				"access_token": "old-access", "refresh_token": "old-refresh",
				"access_expires_at": time.Now().Add(-time.Minute),
			})
		case "/api/v1/auth/refresh":
			var body map[string]any
			_ = json.NewDecoder(request.Body).Decode(&body)
			refreshType, _ = body["client_type"].(string)
			_ = json.NewEncoder(response).Encode(map[string]any{
				"access_token": "new-access", "refresh_token": "new-refresh",
				"access_expires_at": time.Now().Add(time.Hour),
			})
		case "/api/v1/client/sync":
			protectedCalls.Add(1)
			if request.Header.Get("Authorization") != "Bearer new-access" {
				http.Error(response, `{"error_code":"SESSION_REVOKED","message":"bad token"}`, http.StatusUnauthorized)
				return
			}
			_ = json.NewEncoder(response).Encode(map[string]any{
				"device_id": "device", "full_sync": false, "target_config_version": 1,
				"connections": []any{}, "content_hash": "hash", "server_time": time.Now(),
			})
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()
	client, err := New(server.URL+"/api/v1/", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Login(context.Background(), "user", "password"); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Sync(context.Background(), "device", 1, nil); err != nil {
		t.Fatal(err)
	}
	if loginType != "linux" || refreshType != "linux" {
		t.Fatalf("client types: login=%q refresh=%q", loginType, refreshType)
	}
	if protectedCalls.Load() != 1 {
		t.Fatalf("protected calls = %d, want 1", protectedCalls.Load())
	}
}

func TestNormalizeRootRejectsCredentialsAndPaths(t *testing.T) {
	for _, value := range []string{
		"http://console.example.com",
		"https://user:pass@console.example.com",
		"https://console.example.com/admin",
		"https://console.example.com/?token=x",
	} {
		if _, err := normalizeRoot(value); err == nil {
			t.Fatalf("normalizeRoot(%q) unexpectedly succeeded", value)
		}
	}
	if normalized, err := normalizeRoot("console.example.com"); err != nil || !strings.HasPrefix(normalized.String(), "https://") {
		t.Fatalf("normalization failed: %v, %v", normalized, err)
	}
}
