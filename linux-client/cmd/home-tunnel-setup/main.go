//go:build windows

package main

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

//go:embed payload/*
var payload embed.FS

const (
	appName    = "Home Tunnel"
	mbYesNo    = 0x00000004
	mbIconQ    = 0x00000020
	idYes      = 6
	mbOk       = 0x00000000
	mbIconInfo = 0x00000040
	mbIconErr  = 0x00000010
)

func main() {
	user32 := windows.NewLazySystemDLL("user32.dll")
	messageBox := user32.NewProc("MessageBoxW")
	title, _ := windows.UTF16PtrFromString(appName)
	prompt, _ := windows.UTF16PtrFromString("安装 Home Tunnel 到当前用户目录，并创建开始菜单快捷方式？")
	ret, _, _ := messageBox.Call(0, uintptr(unsafe.Pointer(prompt)), uintptr(unsafe.Pointer(title)), mbYesNo|mbIconQ)
	if ret != idYes {
		return
	}
	installDir, err := installPath()
	if err != nil {
		fail(messageBox, title, err.Error())
		return
	}
	if err := os.MkdirAll(installDir, 0o755); err != nil {
		fail(messageBox, title, err.Error())
		return
	}
	if err := extractPayload(installDir); err != nil {
		fail(messageBox, title, err.Error())
		return
	}
	gui := filepath.Join(installDir, "home-tunnel-gui.exe")
	if err := writeUninstall(installDir, gui); err != nil {
		fail(messageBox, title, err.Error())
		return
	}
	if err := createShortcut(gui, filepath.Join(installDir, "HomeTunnel.ico")); err != nil {
		fail(messageBox, title, "已安装，但创建快捷方式失败: "+err.Error())
	}
	done, _ := windows.UTF16PtrFromString("安装完成。即将启动 Home Tunnel。")
	messageBox.Call(0, uintptr(unsafe.Pointer(done)), uintptr(unsafe.Pointer(title)), mbOk|mbIconInfo)
	_ = exec.Command(gui).Start()
}

func installPath() (string, error) {
	local := os.Getenv("LOCALAPPDATA")
	if local == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		local = filepath.Join(home, "AppData", "Local")
	}
	return filepath.Join(local, "Home Tunnel"), nil
}

func extractPayload(dest string) error {
	return fs.WalkDir(payload, "payload", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		data, err := payload.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(dest, filepath.Base(path)), data, 0o755)
	})
}

func writeUninstall(installDir, gui string) error {
	uninst := filepath.Join(installDir, "uninstall.cmd")
	body := "@echo off\r\n" +
		"taskkill /IM home-tunnel-gui.exe /F >nul 2>nul\r\n" +
		"taskkill /IM home-tunnel-agent.exe /F >nul 2>nul\r\n" +
		"reg delete \"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\HomeTunnel\" /f >nul 2>nul\r\n" +
		"rmdir /s /q \"" + installDir + "\"\r\n"
	if err := os.WriteFile(uninst, []byte(body), 0o755); err != nil {
		return err
	}
	key, _, err := registry.CreateKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Uninstall\HomeTunnel`, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	_ = key.SetStringValue("DisplayName", appName)
	_ = key.SetStringValue("DisplayVersion", "4.0.0")
	_ = key.SetStringValue("Publisher", "Home Tunnel")
	_ = key.SetStringValue("InstallLocation", installDir)
	_ = key.SetStringValue("DisplayIcon", gui)
	_ = key.SetStringValue("UninstallString", uninst)
	_ = key.SetDWordValue("NoModify", 1)
	_ = key.SetDWordValue("NoRepair", 1)
	return nil
}

func createShortcut(target, icon string) error {
	programs := filepath.Join(os.Getenv("APPDATA"), "Microsoft", "Windows", "Start Menu", "Programs", "Home Tunnel.lnk")
	ps := fmt.Sprintf("$s = (New-Object -ComObject WScript.Shell).CreateShortcut('%s'); $s.TargetPath = '%s'; $s.WorkingDirectory = '%s'; $s.IconLocation = '%s'; $s.Save()",
		escapePS(programs), escapePS(target), escapePS(filepath.Dir(target)), escapePS(icon))
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", ps)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Run()
}

func escapePS(value string) string {
	return strings.ReplaceAll(value, "'", "''")
}

func fail(messageBox *windows.LazyProc, title *uint16, text string) {
	body, _ := windows.UTF16PtrFromString(text)
	messageBox.Call(0, uintptr(unsafe.Pointer(body)), uintptr(unsafe.Pointer(title)), mbOk|mbIconErr)
}
