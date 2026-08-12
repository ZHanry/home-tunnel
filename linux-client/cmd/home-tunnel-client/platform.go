package main

import (
	"os"
	"runtime"
	"strings"
)

// All operating-system specific defaults and wording live in this file so a
// new platform only needs to touch one place. Linux keeps its historical FHS
// paths. macOS runs the client as a system LaunchDaemon under the dedicated
// _hometunnel user and stores mutable data below /usr/local/var, which works
// on both Intel and Apple Silicon machines without assuming a Homebrew
// prefix. Every default remains overridable through the existing flags and
// HOME_TUNNEL_STATE_PATH / HOME_TUNNEL_AGENT_PATH environment variables.

func defaultStatePath() string {
	if value := strings.TrimSpace(os.Getenv("HOME_TUNNEL_STATE_PATH")); value != "" {
		return value
	}
	if runtime.GOOS == "darwin" {
		return "/usr/local/var/lib/home-tunnel/state.json"
	}
	return "/var/lib/home-tunnel/state.json"
}

func defaultAgentPath() string {
	if value := strings.TrimSpace(os.Getenv("HOME_TUNNEL_AGENT_PATH")); value != "" {
		return value
	}
	// The managed Agent lives in the same location on Linux and macOS.
	return "/usr/local/lib/home-tunnel/home-tunnel-agent"
}

// productName labels the version output and the usage banner.
func productName() string {
	if runtime.GOOS == "darwin" {
		return "Home Tunnel macOS Client"
	}
	return "Home Tunnel Linux Client"
}

// serviceStartHint tells the operator how to start the background service
// after enrolling; the service manager differs per platform.
func serviceStartHint() string {
	if runtime.GOOS == "darwin" {
		return "Load the com.hometunnel.client LaunchDaemon to connect."
	}
	return "Start home-tunnel-client.service to connect."
}
