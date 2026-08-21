package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/ZHanry/home-tunnel/linux-client/internal/model"
)

func TestRenderConfigMatchesManagedSurface(t *testing.T) {
	var contract struct {
		FRPCRender struct {
			MustContain    []string `json:"must_contain"`
			MustNotContain []string `json:"must_not_contain"`
		} `json:"frpc_render"`
	}
	contractPath := filepath.Join("..", "..", "..", "contracts", "home-tunnel.v1.json")
	fixture, err := os.ReadFile(contractPath)
	if err != nil {
		t.Fatalf("read shared contract fixture: %v", err)
	}
	if err := json.Unmarshal(fixture, &contract); err != nil {
		t.Fatalf("parse shared contract fixture: %v", err)
	}
	expires := time.Now().Add(time.Hour)
	configuration, err := RenderConfig(model.Profile{
		FRPSHost: "frps.example.com", FRPSPort: 7000, TunnelDomain: "tunnel.example.com",
	}, model.SyncResponse{
		DeviceID: "device-id", Lease: &model.Lease{Value: "signed-lease", ExpiresAt: expires},
		Connections: []model.Connection{
			{ID: "11111111-2222-3333-4444-555555555555", Subdomain: "http-app", ProxyType: "http", CustomDomains: []string{"home.example.net"}, LocalScheme: "http", LocalHost: "127.0.0.1", LocalPort: 8080, Enabled: true, Version: 2},
			{ID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", Subdomain: "secure-app", ProxyType: "http", LocalScheme: "https", LocalHost: "nas.lan", LocalPort: 8443, Enabled: true, Version: 3},
			{ID: "tcp-connection", Subdomain: "ssh", ProxyType: "tcp", RemotePort: 10001, LocalHost: "127.0.0.1", LocalPort: 22, Enabled: true, Version: 4},
			{ID: "udp-connection", Subdomain: "dns", ProxyType: "udp", RemotePort: 10002, LocalHost: "127.0.0.1", LocalPort: 53, Enabled: true, Version: 5},
			{ID: "disabled", Subdomain: "disabled", ProxyType: "http", LocalScheme: "http", LocalHost: "127.0.0.1", LocalPort: 9, Enabled: false},
		},
	}, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range contract.FRPCRender.MustContain {
		if !strings.Contains(configuration, expected) {
			t.Fatalf("configuration missing %q:\n%s", expected, configuration)
		}
	}
	for _, forbidden := range contract.FRPCRender.MustNotContain {
		if strings.Contains(configuration, forbidden) {
			t.Fatalf("configuration unexpectedly contains %q:\n%s", forbidden, configuration)
		}
	}
	if strings.Contains(configuration, "trustedCaFile") || strings.Contains(configuration, "serverName") {
		t.Fatalf("configuration without a CA must not pin TLS files:\n%s", configuration)
	}
	udpSection := configuration[strings.Index(configuration, `name = "ht_udpconnection_v5"`):]
	for _, expected := range []string{`type = "udp"`, "remotePort = 10002", `localIP = "127.0.0.1"`, "localPort = 53"} {
		if !strings.Contains(udpSection, expected) {
			t.Fatalf("UDP configuration missing %q:\n%s", expected, udpSection)
		}
	}
	if strings.Contains(udpSection, "healthCheck.") {
		t.Fatalf("UDP configuration must not contain TCP health checks:\n%s", udpSection)
	}
}

func TestRenderConfigPinsTrustedCa(t *testing.T) {
	expires := time.Now().Add(time.Hour)
	configuration, err := RenderConfig(model.Profile{
		FRPSHost: "frps.example.com", FRPSPort: 7000, TunnelDomain: "tunnel.example.com",
		FRPSTLSCertificatePEM: "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n",
	}, model.SyncResponse{
		DeviceID: "device-id", Lease: &model.Lease{Value: "signed-lease", ExpiresAt: expires},
	}, "/var/lib/home-tunnel/runtime/frps-ca.pem")
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		`transport.tls.trustedCaFile = "/var/lib/home-tunnel/runtime/frps-ca.pem"`,
		`transport.tls.serverName = "frps.example.com"`,
	} {
		if !strings.Contains(configuration, expected) {
			t.Fatalf("configuration missing %q:\n%s", expected, configuration)
		}
	}
}

func TestRenderConfigRequiresLease(t *testing.T) {
	if _, err := RenderConfig(model.Profile{}, model.SyncResponse{}, ""); err == nil {
		t.Fatal("RenderConfig unexpectedly accepted a missing lease")
	}
}

func TestRenderConfigRejectsUnsupportedProxyType(t *testing.T) {
	_, err := RenderConfig(model.Profile{}, model.SyncResponse{
		DeviceID: "device-id",
		Lease:    &model.Lease{Value: "signed-lease", ExpiresAt: time.Now().Add(time.Hour)},
		Connections: []model.Connection{{
			ID: "unsupported", ProxyType: "stcp", Enabled: true,
		}},
	}, "")
	if err == nil || !strings.Contains(err.Error(), "unsupported proxy type") {
		t.Fatalf("RenderConfig error = %v, want unsupported proxy type", err)
	}
}

func TestSupervisorWritesTrustedCaAndArguments(t *testing.T) {
	pem := "-----BEGIN CERTIFICATE-----\ntest-only-frps-ca\n-----END CERTIFICATE-----\n"
	runtimeDir := filepath.Join(t.TempDir(), "runtime")
	supervisor, err := New(
		filepath.Join(t.TempDir(), "missing-agent"),
		runtimeDir,
		"development",
		model.Profile{FRPSHost: "frps.example.com", FRPSPort: 7000, TunnelDomain: "tunnel.example.com", FRPSTLSCertificatePEM: pem},
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	caPath := filepath.Join(runtimeDir, "frps-ca.pem")
	content, err := os.ReadFile(caPath)
	if err != nil {
		t.Fatalf("managed CA file missing: %v", err)
	}
	if string(content) != pem {
		t.Fatalf("managed CA file content mismatch:\n%s", content)
	}
	if runtime.GOOS == "linux" {
		info, err := os.Stat(caPath)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("managed CA file mode = %v, want 0600", info.Mode().Perm())
		}
	}
	digest := sha256.Sum256([]byte(pem))
	expectedArgument := hex.EncodeToString(digest[:])
	arguments := supervisor.arguments("verify", "config.toml")
	found := false
	for index, argument := range arguments {
		if argument == "--tls-ca-sha256" && index+1 < len(arguments) && arguments[index+1] == expectedArgument {
			found = true
		}
	}
	if !found {
		t.Fatalf("arguments missing --tls-ca-sha256 %s: %v", expectedArgument, arguments)
	}

	plain, err := New(
		filepath.Join(t.TempDir(), "missing-agent"),
		filepath.Join(t.TempDir(), "runtime"),
		"development",
		model.Profile{FRPSHost: "frps.example.com", FRPSPort: 7000, TunnelDomain: "tunnel.example.com"},
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	for _, argument := range plain.arguments("verify", "config.toml") {
		if argument == "--tls-ca-sha256" {
			t.Fatal("profile without a certificate must not pass --tls-ca-sha256")
		}
	}
}

func TestSupervisorPassesCustomDomainAllowlist(t *testing.T) {
	supervisor, err := New(
		filepath.Join(t.TempDir(), "missing-agent"),
		filepath.Join(t.TempDir(), "runtime"),
		"development",
		model.Profile{FRPSHost: "frps.example.com", FRPSPort: 7000, TunnelDomain: "tunnel.example.com"},
		nil,
		[]model.Connection{
			{ProxyType: "http", Enabled: true, CustomDomains: []string{"HOME.example.net", "blog.example.net"}},
			{ProxyType: "http", Enabled: false, CustomDomains: []string{"disabled.example.net"}},
			{ProxyType: "tcp", Enabled: true, RemotePort: 10002, CustomDomains: []string{"raw.example.net"}},
			{ProxyType: "tcp", Enabled: true, RemotePort: 10001},
			{ProxyType: "tcp", Enabled: true, RemotePort: 10002},
			{ProxyType: "tcp", Enabled: false, RemotePort: 10003},
			{ProxyType: "udp", Enabled: true, RemotePort: 20002},
			{ProxyType: "udp", Enabled: true, RemotePort: 20001},
			{ProxyType: "udp", Enabled: true, RemotePort: 20002},
			{ProxyType: "udp", Enabled: false, RemotePort: 20003},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	arguments := strings.Join(supervisor.arguments("verify", "config.toml"), " ")
	if !strings.Contains(arguments, "--allow-custom-domains blog.example.net,home.example.net") {
		t.Fatalf("arguments missing normalized custom-domain allowlist: %s", arguments)
	}
	if !strings.Contains(arguments, "--allow-tcp-ports 10001,10002") {
		t.Fatalf("arguments missing sorted TCP port allowlist: %s", arguments)
	}
	if !strings.Contains(arguments, "--allow-udp-ports 20001,20002") {
		t.Fatalf("arguments missing sorted UDP port allowlist: %s", arguments)
	}
	for _, forbidden := range []string{"disabled.example.net", "raw.example.net", "10003", "20003"} {
		if strings.Contains(arguments, forbidden) {
			t.Fatalf("arguments unexpectedly allow disabled or non-HTTP resource %q: %s", forbidden, arguments)
		}
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
		ID: "11111111-2222-3333-4444-555555555555", Subdomain: "app", ProxyType: "http", LocalScheme: "http",
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
