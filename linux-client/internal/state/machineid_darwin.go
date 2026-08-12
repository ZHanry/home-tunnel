//go:build darwin

package state

import (
	"context"
	"os/exec"
	"strings"
	"time"
)

// readMachineID returns the stable hardware IOPlatformUUID, queried through
// ioreg so the client stays free of cgo and third-party dependencies. The
// value only feeds the enrollment fingerprint hash; any failure falls back to
// the same sentinel as Linux because the random per-install ID already keeps
// the fingerprint unique.
func readMachineID() string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, "/usr/sbin/ioreg", "-rd1", "-c", "IOPlatformExpertDevice").Output()
	if err != nil {
		return "machine-id-unavailable"
	}
	for _, line := range strings.Split(string(output), "\n") {
		if !strings.Contains(line, `"IOPlatformUUID"`) {
			continue
		}
		_, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		value = strings.Trim(strings.TrimSpace(value), `"`)
		if value != "" {
			return value
		}
	}
	return "machine-id-unavailable"
}
