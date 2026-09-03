//go:build darwin && !cgo

package desktop

func startTray(func(), func()) {}

func stopTray() {}
