package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/ZHanry/home-tunnel/linux-client/internal/model"
)

func TestRenderConfigMatchesManagedSurface(t *testing.T) {
	expires := time.Now().Add(time.Hour)
	configuration, err := RenderConfig(model.Profile{
		FRPSHost: "frps.example.com", FRPSPort: 7000, TunnelDomain: "tunnel.example.com",
	}, model.SyncResponse{
		DeviceID: "device-id", Lease: &model.Lease{Value: "signed-lease", ExpiresAt: expires},
		Connections: []model.Connection{
			{ID: "11111111-2222-3333-4444-555555555555", Subdomain: "http-app", LocalScheme: "http", LocalHost: "127.0.0.1", LocalPort: 8080, Enabled: true, Version: 2},
			{ID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", Subdomain: "secure-app", LocalScheme: "https", LocalHost: "nas.lan", LocalPort: 8443, Enabled: true, Version: 3},
			{ID: "disabled", Subdomain: "disabled", LocalScheme: "http", LocalHost: "127.0.0.1", LocalPort: 9, Enabled: false},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		`serverAddr = "frps.example.com"`,
		`metadatas.home_tunnel_lease = "signed-lease"`,
		`customDomains = ["http-app.tunnel.example.com"]`,
		`localIP = "127.0.0.1"`,
		`type = "http2https"`,
		`localAddr = "nas.lan:8443"`,
	} {
		if !strings.Contains(configuration, expected) {
			t.Fatalf("configuration missing %q:\n%s", expected, configuration)
		}
	}
	if strings.Contains(configuration, "disabled.tunnel.example.com") {
		t.Fatalf("disabled connection was rendered:\n%s", configuration)
	}
}

func TestRenderConfigRequiresLease(t *testing.T) {
	if _, err := RenderConfig(model.Profile{}, model.SyncResponse{}); err == nil {
		t.Fatal("RenderConfig unexpectedly accepted a missing lease")
	}
}

func TestTickHonorsPersistedExpiredLease(t *testing.T) {
	expired := time.Now().Add(-time.Minute)
	supervisor, err := New(
		filepath.Join(t.TempDir(), "missing-agent"),
		filepath.Join(t.TempDir(), "runtime"),
		"development",
		model.Profile{},
		&expired,
	)
	if err != nil {
		t.Fatal(err)
	}
	status, _ := supervisor.Tick(time.Now())
	if status != "ExpiredStop" {
		t.Fatalf("status = %q, want ExpiredStop", status)
	}
}

func TestApplyStartsAndStopsManagedAgent(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("process lifecycle fixture is Linux-specific")
	}
	root := t.TempDir()
	agentPath := filepath.Join(root, "fake-agent")
	script := "#!/bin/sh\n" +
		"if [ \"$1\" = verify ]; then exit 0; fi\n" +
		"trap 'exit 0' INT TERM\n" +
		"while :; do sleep 1; done\n"
	if err := os.WriteFile(agentPath, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte(script))
	expires := time.Now().Add(time.Hour)
	profile := model.Profile{FRPSHost: "frps.example.com", FRPSPort: 7000, TunnelDomain: "tunnel.example.com"}
	supervisor, err := New(agentPath, filepath.Join(root, "runtime"), hex.EncodeToString(hash[:]), profile, nil)
	if err != nil {
		t.Fatal(err)
	}
	state := model.State{Profile: profile, CachedConnections: []model.Connection{{
		ID: "11111111-2222-3333-4444-555555555555", Subdomain: "app", LocalScheme: "http",
		LocalHost: "127.0.0.1", LocalPort: 8080, Enabled: true, Version: 1,
	}}}
	syncResponse := model.SyncResponse{
		DeviceID: "device-id", TargetConfigVersion: 1, Connections: state.CachedConnections,
		Lease: &model.Lease{Value: "signed-lease", ExpiresAt: expires, ConfigVersion: 1},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := supervisor.Apply(ctx, &state, syncResponse); err != nil {
		t.Fatal(err)
	}
	if !supervisor.Running() || state.AgentState != "Online" || state.AppliedConfigVersion != 1 {
		t.Fatalf("agent did not reach Online: running=%v state=%#v", supervisor.Running(), state)
	}
	if _, err := os.Stat(filepath.Join(root, "runtime", "lkg-1.toml")); err != nil {
		t.Fatalf("last-known-good configuration missing: %v", err)
	}
	if err := supervisor.Stop(); err != nil {
		t.Fatal(err)
	}
	if supervisor.Running() {
		t.Fatal("agent still running after Stop")
	}
}
