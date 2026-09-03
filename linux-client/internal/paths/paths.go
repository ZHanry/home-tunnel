package paths

import (
	"os"
	"path/filepath"
	"runtime"
)

func DesktopStatePath() string {
	if value := os.Getenv("HOME_TUNNEL_STATE_PATH"); value != "" {
		return value
	}
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "windows":
		if appData := os.Getenv("APPDATA"); appData != "" {
			return filepath.Join(appData, "HomeTunnel", "state.json")
		}
		return filepath.Join(home, "AppData", "Roaming", "HomeTunnel", "state.json")
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "HomeTunnel", "state.json")
	default:
		if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" {
			return filepath.Join(xdg, "home-tunnel", "state.json")
		}
		return filepath.Join(home, ".local", "share", "home-tunnel", "state.json")
	}
}

func DesktopAgentPath() string {
	if value := os.Getenv("HOME_TUNNEL_AGENT_PATH"); value != "" {
		return value
	}
	exe, err := os.Executable()
	if err == nil {
		dir := filepath.Dir(exe)
		for _, candidate := range []string{
			filepath.Join(dir, agentFileName()),
			filepath.Join(dir, "lib", agentFileName()),
			filepath.Join(dir, "..", "lib", agentFileName()),
		} {
			if info, statErr := os.Stat(candidate); statErr == nil && !info.IsDir() {
				return candidate
			}
		}
		if runtime.GOOS == "windows" {
			return filepath.Join(dir, agentFileName())
		}
	}
	return "/usr/local/lib/home-tunnel/" + agentFileName()
}

func agentFileName() string {
	if runtime.GOOS == "windows" {
		return "home-tunnel-agent.exe"
	}
	return "home-tunnel-agent"
}
