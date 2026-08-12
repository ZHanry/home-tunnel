package state

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/ZHanry/home-tunnel/linux-client/internal/model"
)

func TestStoreRoundTripProtectsCredentialFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data", "state.json")
	store := Store{Path: path}
	input := model.State{
		InstallID:        "install-12345678",
		DeviceID:         "device-id",
		DeviceCredential: "secret-device-credential",
		Profile: model.Profile{
			PublicBaseURL: "https://console.example.com/",
			APIBaseURL:    "https://console.example.com/api/v1/",
		},
	}
	if err := store.Save(input); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); runtime.GOOS != "windows" && got != 0o600 {
		t.Fatalf("state mode = %o, want 600", got)
	}
	loaded, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.DeviceCredential != input.DeviceCredential || loaded.Profile.APIBaseURL != input.Profile.APIBaseURL {
		t.Fatalf("round trip mismatch: %#v", loaded)
	}
}

func TestLoadCreatesInstallID(t *testing.T) {
	store := Store{Path: filepath.Join(t.TempDir(), "state.json")}
	loaded, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.InstallID) != 32 {
		t.Fatalf("install id length = %d, want 32", len(loaded.InstallID))
	}
}
