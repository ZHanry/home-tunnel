//go:build linux

package state

import (
	"io"
	"os"
	"strings"
)

// readMachineID prefers the systemd machine ID and falls back to the legacy
// D-Bus copy. The value only feeds the enrollment fingerprint hash; when both
// files are missing the random per-install ID still keeps it unique.
func readMachineID() string {
	for _, path := range []string{"/etc/machine-id", "/var/lib/dbus/machine-id"} {
		file, err := os.Open(path)
		if err != nil {
			continue
		}
		data, readErr := io.ReadAll(io.LimitReader(file, 256))
		file.Close()
		if readErr == nil && strings.TrimSpace(string(data)) != "" {
			return strings.TrimSpace(string(data))
		}
	}
	return "machine-id-unavailable"
}
