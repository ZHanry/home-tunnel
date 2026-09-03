package desktop

import (
	"runtime"

	"fyne.io/systray"
)

func setupTrayMenu(show, quit func()) {
	if runtime.GOOS == "windows" {
		systray.SetIcon(iconICO)
	} else {
		systray.SetIcon(iconPNG)
	}
	systray.SetTitle("Home Tunnel")
	systray.SetTooltip("Home Tunnel")
	openItem := systray.AddMenuItem("打开界面", "Show Home Tunnel")
	systray.AddSeparator()
	quitItem := systray.AddMenuItem("退出", "Quit Home Tunnel")
	go func() {
		for {
			select {
			case <-openItem.ClickedCh:
				if show != nil {
					show()
				}
			case <-quitItem.ClickedCh:
				if quit != nil {
					quit()
				}
				return
			}
		}
	}()
}
