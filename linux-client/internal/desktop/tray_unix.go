//go:build linux || (darwin && cgo)

package desktop

import "fyne.io/systray"

func startTray(show, quit func()) {
	start, _ := systray.RunWithExternalLoop(func() {
		setupTrayMenu(show, quit)
	}, nil)
	start()
}

func stopTray() {
	systray.Quit()
}
