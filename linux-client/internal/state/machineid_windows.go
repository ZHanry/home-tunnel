//go:build windows

package state

import (
	"os/exec"
	"strings"
)

func readMachineID() string {
	output, err := exec.Command("reg", "query", `HKLM\SOFTWARE\Microsoft\Cryptography`, "/v", "MachineGuid").Output()
	if err != nil {
		return "machine-id-unavailable"
	}
	for _, line := range strings.Split(string(output), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 3 && strings.EqualFold(fields[0], "MachineGuid") {
			return strings.TrimSpace(fields[len(fields)-1])
		}
	}
	return "machine-id-unavailable"
}
