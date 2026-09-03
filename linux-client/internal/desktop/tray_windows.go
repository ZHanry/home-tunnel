//go:build windows

package desktop

import "fyne.io/systray"

func startTray(show, quit func()) {
	systray.Register(func() {
		setupTrayMenu(show, quit)
	}, nil)
}

func stopTray() {
	systray.Quit()
}
