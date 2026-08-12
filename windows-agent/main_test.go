// 受管配置校验测试。
//
// windows-agent 没有独立的 go.mod：构建时 main.go 会被复制进固定提交的 FRP
// 源码树 cmd/home-tunnel-agent 目录编译。运行本测试时按同样方式把 main.go
// 与本文件一起复制进该目录后执行 go test（参见 build-agent.ps1 的布局）。
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const testServer = "203.0.113.10"
const testPort = 7000
const testDomain = "tunnel.example.com"

const validManagedConfig = `serverAddr = "203.0.113.10"
serverPort = 7000
user = "test-device"
loginFailExit = true
transport.tls.enable = true
transport.tls.disableCustomTLSFirstByte = true
transport.heartbeatInterval = 30
transport.heartbeatTimeout = 90
metadatas.home_tunnel_lease = "test-only-lease"
log.to = "console"
log.level = "info"

[[proxies]]
name = "ht_test_v1"
type = "http"
customDomains = ["agent-test.tunnel.example.com"]
transport.useEncryption = true
transport.useCompression = true
healthCheck.type = "tcp"
healthCheck.timeoutSeconds = 3
healthCheck.intervalSeconds = 10
localIP = "127.0.0.1"
localPort = 5088
`

func loadConfig(t *testing.T, content string) error {
	t.Helper()
	return loadConfigWithTrust(t, content, trustProfile{server: testServer, port: testPort, domain: testDomain})
}

func loadConfigWithTrust(t *testing.T, content string, trust trustProfile) error {
	t.Helper()
	path := filepath.Join(t.TempDir(), "managed.toml")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	_, _, err := loadManagedConfig(path, trust)
	return err
}

// writeTestCa 写入一个受管 CA 文件并返回其路径与内容 SHA-256（小写十六进制）。
func writeTestCa(t *testing.T, content string) (string, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "frps-ca.pem")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write ca: %v", err)
	}
	digest := sha256.Sum256([]byte(content))
	return path, hex.EncodeToString(digest[:])
}

func caManagedConfig(caPath string) string {
	return strings.Replace(validManagedConfig,
		"transport.tls.disableCustomTLSFirstByte = true\n",
		"transport.tls.disableCustomTLSFirstByte = true\n"+
			"transport.tls.trustedCaFile = "+tomlQuote(caPath)+"\n"+
			"transport.tls.serverName = \""+testServer+"\"\n",
		1)
}

func tomlQuote(value string) string {
	return "\"" + strings.ReplaceAll(value, "\\", "\\\\") + "\""
}

func TestValidManagedConfigAccepted(t *testing.T) {
	if err := loadConfig(t, validManagedConfig); err != nil {
		t.Fatalf("valid managed config rejected: %v", err)
	}
}

func TestLinuxAndWindowsClientShapeWithPluginAccepted(t *testing.T) {
	config := strings.Replace(validManagedConfig,
		"localIP = \"127.0.0.1\"\nlocalPort = 5088\n",
		"[proxies.plugin]\ntype = \"http2https\"\nlocalAddr = \"192.168.1.20:5001\"\nhostHeaderRewrite = \"192.168.1.20\"\n",
		1)
	if err := loadConfig(t, config); err != nil {
		t.Fatalf("managed https plugin config rejected: %v", err)
	}
}

func TestManagedSurfaceRejections(t *testing.T) {
	cases := []struct {
		name string
		line string
	}{
		{"dns server override", "dnsServer = \"198.51.100.53\""},
		{"stun server override", "natHoleStunServer = \"attacker.example:3478\""},
		{"login fail exit disabled", ""}, // 单独处理：替换而不是追加
		{"udp packet size override", "udpPacketSize = 9000"},
		{"tcp mux disabled", "transport.tcpMux = false"},
		{"tcp mux keepalive override", "transport.tcpMuxKeepaliveInterval = 5"},
		{"pool count override", "transport.poolCount = 8"},
		{"dial server timeout override", "transport.dialServerTimeout = 60"},
		{"dial server keepalive override", "transport.dialServerKeepalive = 60"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			config := validManagedConfig
			if test.name == "login fail exit disabled" {
				config = strings.Replace(config, "loginFailExit = true", "loginFailExit = false", 1)
			} else {
				config = strings.Replace(config, "user = \"test-device\"", "user = \"test-device\"\n"+test.line, 1)
			}
			if err := loadConfig(t, config); err == nil {
				t.Fatalf("%s was accepted", test.name)
			}
		})
	}
}

// 白名单默认拒绝：以下字段从未出现在历史黑名单中，设置非默认值必须被拒，
// 证明未来 FRP 新增字段也无法绕过受管模板。
func TestUnlistedCommonFieldRejected(t *testing.T) {
	config := strings.Replace(validManagedConfig, "user = \"test-device\"",
		"user = \"test-device\"\ntransport.quic.keepalivePeriod = 20", 1)
	if err := loadConfig(t, config); err == nil {
		t.Fatal("unlisted transport.quic.keepalivePeriod override was accepted")
	}
}

func TestUnlistedProxyFieldRejected(t *testing.T) {
	config := strings.Replace(validManagedConfig, "healthCheck.intervalSeconds = 10",
		"healthCheck.intervalSeconds = 10\nhealthCheck.maxFailed = 5", 1)
	if err := loadConfig(t, config); err == nil {
		t.Fatal("unlisted healthCheck.maxFailed override was accepted")
	}
}

// clientRenderedConfig 逐行复刻两个客户端 RenderConfig 的输出形态（
// windows-client\Services\FrpcSupervisor.cs 与 linux-client\internal\agent\
// supervisor.go 生成完全一致的 TOML）：HTTP 直连与 HTTPS 插件后端各一条，
// caPath 非空时追加 trustedCaFile/serverName 两行。
func clientRenderedConfig(caPath string) string {
	var builder strings.Builder
	builder.WriteString("serverAddr = \"" + testServer + "\"\n")
	builder.WriteString("serverPort = 7000\n")
	builder.WriteString("user = \"device-1234\"\n")
	builder.WriteString("loginFailExit = true\n")
	builder.WriteString("transport.tls.enable = true\n")
	builder.WriteString("transport.tls.disableCustomTLSFirstByte = true\n")
	if caPath != "" {
		builder.WriteString("transport.tls.trustedCaFile = " + tomlQuote(caPath) + "\n")
		builder.WriteString("transport.tls.serverName = \"" + testServer + "\"\n")
	}
	builder.WriteString("transport.heartbeatInterval = 30\n")
	builder.WriteString("transport.heartbeatTimeout = 90\n")
	builder.WriteString("metadatas.home_tunnel_lease = \"lease-token\"\n")
	builder.WriteString("log.to = \"console\"\n")
	builder.WriteString("log.level = \"info\"\n")
	builder.WriteString("\n[[proxies]]\n")
	builder.WriteString("name = \"ht_11112222333344445555666677778888_v3\"\n")
	builder.WriteString("type = \"http\"\n")
	builder.WriteString("customDomains = [\"blog." + testDomain + "\"]\n")
	builder.WriteString("transport.useEncryption = true\n")
	builder.WriteString("transport.useCompression = true\n")
	builder.WriteString("healthCheck.type = \"tcp\"\n")
	builder.WriteString("healthCheck.timeoutSeconds = 3\n")
	builder.WriteString("healthCheck.intervalSeconds = 10\n")
	builder.WriteString("localIP = \"127.0.0.1\"\n")
	builder.WriteString("localPort = 8080\n")
	builder.WriteString("\n[[proxies]]\n")
	builder.WriteString("name = \"ht_99990000aaaabbbbccccddddeeeeffff_v7\"\n")
	builder.WriteString("type = \"http\"\n")
	builder.WriteString("customDomains = [\"nas." + testDomain + "\"]\n")
	builder.WriteString("transport.useEncryption = true\n")
	builder.WriteString("transport.useCompression = true\n")
	builder.WriteString("healthCheck.type = \"tcp\"\n")
	builder.WriteString("healthCheck.timeoutSeconds = 3\n")
	builder.WriteString("healthCheck.intervalSeconds = 10\n")
	builder.WriteString("[proxies.plugin]\n")
	builder.WriteString("type = \"http2https\"\n")
	builder.WriteString("localAddr = \"192.168.1.20:5001\"\n")
	builder.WriteString("hostHeaderRewrite = \"192.168.1.20\"\n")
	return builder.String()
}

func TestClientRenderedShapeWithoutCaAccepted(t *testing.T) {
	if err := loadConfig(t, clientRenderedConfig("")); err != nil {
		t.Fatalf("client-rendered config without CA rejected: %v", err)
	}
}

func TestClientRenderedShapeWithCaAccepted(t *testing.T) {
	caPath, caHash := writeTestCa(t, testCaPem)
	trust := trustProfile{server: testServer, port: testPort, domain: testDomain, tlsCaSha256: caHash}
	if err := loadConfigWithTrust(t, clientRenderedConfig(caPath), trust); err != nil {
		t.Fatalf("client-rendered config with CA rejected: %v", err)
	}
}

func TestProxySubdomainRejected(t *testing.T) {
	config := strings.Replace(validManagedConfig,
		"customDomains = [\"agent-test.tunnel.example.com\"]",
		"customDomains = [\"agent-test.tunnel.example.com\"]\nsubdomain = \"evil\"",
		1)
	if err := loadConfig(t, config); err == nil {
		t.Fatal("proxy with both customDomains and subdomain was accepted")
	}
}

func TestServerMismatchStillRejected(t *testing.T) {
	config := strings.Replace(validManagedConfig, "serverPort = 7000", "serverPort = 7001", 1)
	if err := loadConfig(t, config); err == nil {
		t.Fatal("config with mismatched server port was accepted")
	}
}

const testCaPem = "-----BEGIN CERTIFICATE-----\ntest-only-frps-ca\n-----END CERTIFICATE-----\n"

func TestManagedCaConfigAccepted(t *testing.T) {
	caPath, caHash := writeTestCa(t, testCaPem)
	trust := trustProfile{server: testServer, port: testPort, domain: testDomain, tlsCaSha256: caHash}
	if err := loadConfigWithTrust(t, caManagedConfig(caPath), trust); err != nil {
		t.Fatalf("managed CA config rejected: %v", err)
	}
}

func TestManagedCaHashMismatchRejected(t *testing.T) {
	caPath, _ := writeTestCa(t, testCaPem)
	trust := trustProfile{
		server: testServer, port: testPort, domain: testDomain,
		tlsCaSha256: strings.Repeat("0", 64),
	}
	if err := loadConfigWithTrust(t, caManagedConfig(caPath), trust); err == nil {
		t.Fatal("managed CA file with mismatched hash was accepted")
	}
}

func TestManagedCaFlagWithoutTrustedCaFileRejected(t *testing.T) {
	_, caHash := writeTestCa(t, testCaPem)
	trust := trustProfile{server: testServer, port: testPort, domain: testDomain, tlsCaSha256: caHash}
	if err := loadConfigWithTrust(t, validManagedConfig, trust); err == nil {
		t.Fatal("config without trustedCaFile was accepted despite --tls-ca-sha256")
	}
}

func TestTrustedCaFileWithoutFlagRejected(t *testing.T) {
	caPath, _ := writeTestCa(t, testCaPem)
	if err := loadConfig(t, caManagedConfig(caPath)); err == nil {
		t.Fatal("config with trustedCaFile was accepted without --tls-ca-sha256")
	}
}

func TestManagedCaServerNameMismatchRejected(t *testing.T) {
	caPath, caHash := writeTestCa(t, testCaPem)
	trust := trustProfile{server: testServer, port: testPort, domain: testDomain, tlsCaSha256: caHash}
	config := strings.Replace(caManagedConfig(caPath),
		"transport.tls.serverName = \""+testServer+"\"",
		"transport.tls.serverName = \"attacker.example\"", 1)
	if err := loadConfigWithTrust(t, config, trust); err == nil {
		t.Fatal("config with mismatched TLS serverName was accepted")
	}
}
