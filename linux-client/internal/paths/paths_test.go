package paths

import (
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestDesktopStatePathHonorsOverride(t *testing.T) {
	t.Setenv("HOME_TUNNEL_STATE_PATH", filepath.Join(t.TempDir(), "custom.json"))
	got := DesktopStatePath()
	if !strings.HasSuffix(got, "custom.json") {
		t.Fatalf("override not honored: %s", got)
	}
}

func TestDesktopStatePathUsesPlatformHome(t *testing.T) {
	t.Setenv("HOME_TUNNEL_STATE_PATH", "")
	got := DesktopStatePath()
	switch runtime.GOOS {
	case "windows":
		if !strings.Contains(got, "HomeTunnel") {
			t.Fatalf("windows state path should be under HomeTunnel: %s", got)
		}
	case "darwin":
		if !strings.Contains(got, "Application Support") {
			t.Fatalf("macOS state path should be under Application Support: %s", got)
		}
	default:
		if !strings.Contains(got, "home-tunnel") {
			t.Fatalf("linux state path should contain home-tunnel: %s", got)
		}
	}
}

func TestDesktopAgentPathOverride(t *testing.T) {
	want := filepath.Join(t.TempDir(), "custom-agent")
	t.Setenv("HOME_TUNNEL_AGENT_PATH", want)
	if DesktopAgentPath() != want {
		t.Fatalf("agent override ignored: %s", DesktopAgentPath())
	}
}
