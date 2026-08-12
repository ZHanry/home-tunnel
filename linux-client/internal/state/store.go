package state

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ZHanry/home-tunnel/linux-client/internal/model"
)

type Store struct {
	Path string
}

func (store Store) Load() (model.State, error) {
	var value model.State
	data, err := os.ReadFile(store.Path)
	if errors.Is(err, os.ErrNotExist) {
		value.InstallID, err = randomID(16)
		return value, err
	}
	if err != nil {
		return value, fmt.Errorf("read state: %w", err)
	}
	if err := json.Unmarshal(data, &value); err != nil {
		damaged := fmt.Sprintf("%s.damaged-%d", store.Path, time.Now().Unix())
		if renameErr := os.Rename(store.Path, damaged); renameErr != nil {
			return value, fmt.Errorf("decode state: %w (also failed to preserve damaged state: %v)", err, renameErr)
		}
		value.InstallID, err = randomID(16)
		if err != nil {
			return value, err
		}
		return value, fmt.Errorf("decode state: %w (preserved as %s)", err, damaged)
	}
	if value.InstallID == "" {
		value.InstallID, err = randomID(16)
	}
	return value, err
}

func (store Store) Save(value model.State) error {
	directory := filepath.Dir(store.Path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create state directory: %w", err)
	}
	value.UpdatedAt = time.Now().UTC()
	temporary, err := os.CreateTemp(directory, ".state-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary state: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary state: %w", err)
	}
	encoder := json.NewEncoder(temporary)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		temporary.Close()
		return fmt.Errorf("encode state: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("flush state: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close state: %w", err)
	}
	if err := os.Rename(temporaryPath, store.Path); err != nil {
		return fmt.Errorf("replace state: %w", err)
	}
	return os.Chmod(store.Path, 0o600)
}

func Fingerprint(installID string) (string, error) {
	hostname, err := os.Hostname()
	if err != nil {
		return "", fmt.Errorf("read hostname: %w", err)
	}
	machineID := readMachineID()
	material := hostname + "\n" + machineID + "\n" + installID
	hash := sha256.Sum256([]byte(material))
	return hex.EncodeToString(hash[:]), nil
}

func readMachineID() string {
	for _, path := range []string{"/etc/machine-id", "/var/lib/dbus/machine-id"} {
		file, err := os.Open(path)
		if err != nil {
			continue
		}
		data, readErr := io.ReadAll(io.LimitReader(file, 256))
		file.Close()
		if readErr == nil && strings.TrimSpace(string(data)) != "" {
			return strings.TrimSpace(string(data))
		}
	}
	return "machine-id-unavailable"
}

func randomID(size int) (string, error) {
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		return "", fmt.Errorf("generate install id: %w", err)
	}
	return hex.EncodeToString(data), nil
}
