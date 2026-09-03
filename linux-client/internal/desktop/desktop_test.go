package desktop

import "testing"

func TestEmbeddedIcons(t *testing.T) {
	if len(iconICO) < 32 {
		t.Fatal("Windows tray icon is missing")
	}
	if len(iconPNG) < 32 || iconPNG[0] != 0x89 || iconPNG[1] != 0x50 {
		t.Fatal("PNG tray icon is missing")
	}
}
