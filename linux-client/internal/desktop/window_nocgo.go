//go:build !windows && !cgo

package desktop

import "fmt"

func createNativeWindow(string) error {
	return fmt.Errorf("home-tunnel-gui must be built with CGO on Linux and macOS so it can create a native window")
}

func runNativeWindow() {}

func showNativeWindow() {}

func quitNativeWindow() {}
