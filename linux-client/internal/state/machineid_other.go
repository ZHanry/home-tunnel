//go:build !linux && !darwin

package state

// readMachineID has no portable source on the remaining platforms (only
// Windows development builds compile this file); the random per-install ID
// keeps the enrollment fingerprint unique on its own.
func readMachineID() string {
	return "machine-id-unavailable"
}
