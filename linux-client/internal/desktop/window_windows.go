//go:build windows

package desktop

import (
	"fmt"
	"syscall"
	"unsafe"

	"github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

const (
	wmClose     = 0x0010
	swHide      = 0
	swShow      = 5
	swRestore   = 9
	mbOk        = 0x00000000
	mbIconError = 0x00000010
)

var (
	user32               = windows.NewLazySystemDLL("user32.dll")
	procShowWindow       = user32.NewProc("ShowWindow")
	procSetForeground    = user32.NewProc("SetForegroundWindow")
	procSetWindowLongPtr = user32.NewProc("SetWindowLongPtrW")
	procCallWindowProc   = user32.NewProc("CallWindowProcW")
	procMessageBoxW      = user32.NewProc("MessageBoxW")
)

var (
	nativeView   webview2.WebView
	nativeHWND   uintptr
	originalProc uintptr
)

func createNativeWindow(url string) error {
	view := webview2.NewWithOptions(webview2.WebViewOptions{
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title:  "Home Tunnel",
			Width:  520,
			Height: 820,
			Center: true,
		},
	})
	if view == nil {
		showWebView2Error()
		return fmt.Errorf("Microsoft Edge WebView2 runtime is not available")
	}
	nativeView = view
	nativeHWND = uintptr(view.Window())
	subclassHideOnClose(nativeHWND)
	view.Navigate(url)
	return nil
}

func runNativeWindow() {
	if nativeView != nil {
		nativeView.Run()
	}
}

func showNativeWindow() {
	if nativeView == nil {
		return
	}
	nativeView.Dispatch(func() {
		if nativeHWND == 0 {
			return
		}
		procShowWindow.Call(nativeHWND, swRestore)
		procShowWindow.Call(nativeHWND, swShow)
		procSetForeground.Call(nativeHWND)
	})
}

func quitNativeWindow() {
	if nativeView != nil {
		nativeView.Terminate()
	}
}

func subclassHideOnClose(hwnd uintptr) {
	cb := syscall.NewCallback(hideOnCloseProc)
	originalProc, _, _ = procSetWindowLongPtr.Call(hwnd, ^uintptr(3), cb)
}

func hideOnCloseProc(hwnd, msg, wParam, lParam uintptr) uintptr {
	if msg == wmClose {
		procShowWindow.Call(hwnd, swHide)
		return 0
	}
	ret, _, _ := procCallWindowProc.Call(originalProc, hwnd, msg, wParam, lParam)
	return ret
}

func showWebView2Error() {
	title, _ := windows.UTF16PtrFromString("Home Tunnel")
	text, _ := windows.UTF16PtrFromString("无法创建窗口。请安装 Microsoft Edge WebView2 Runtime 后再打开 Home Tunnel。")
	procMessageBoxW.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), mbOk|mbIconError)
}
