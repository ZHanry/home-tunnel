package gui

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/ZHanry/home-tunnel/linux-client/internal/model"
)

func TestParseChecksum(t *testing.T) {
	got := parseChecksum("abc123  HomeTunnel-Setup-4.0.0-x64.exe\n", "HomeTunnel-Setup-4.0.0-x64.exe")
	if got != "abc123" {
		t.Fatalf("got %q", got)
	}
	if parseChecksum("deadbeef\n", "file.zip") != "deadbeef" {
		t.Fatal("single-field checksum")
	}
}

func TestPackageAssetMatchesCurrentOS(t *testing.T) {
	release := githubRelease{
		TagName: "v3.2.1",
		Assets: []struct {
			Name string `json:"name"`
			URL  string `json:"browser_download_url"`
		}{
			{Name: "HomeTunnel-Setup-3.2.1-x64.exe", URL: "https://example.com/win.zip"},
			{Name: "HomeTunnel-Setup-3.2.1-x64.exe.sha256", URL: "https://example.com/win.sha256"},
			{Name: "home-tunnel-linux-3.2.1-amd64.tar.gz", URL: "https://example.com/linux.tgz"},
			{Name: "home-tunnel-macos-3.2.1-arm64.tar.gz", URL: "https://example.com/mac.tgz"},
		},
	}
	name, url, checksum := packageAsset(release)
	if runtime.GOOS == "windows" {
		if name != "HomeTunnel-Setup-3.2.1-x64.exe" || url == "" || checksum == "" {
			t.Fatalf("windows asset %q %q %q", name, url, checksum)
		}
	}
}

func TestUpdateCheckUsesReleaseAsset(t *testing.T) {
	payload, _ := json.Marshal(map[string]any{
		"tag_name": "v9.9.9",
		"html_url": "https://github.com/ZHanry/home-tunnel/releases/tag/v9.9.9",
		"assets": []map[string]string{
			{"name": "HomeTunnel-Setup-9.9.9-x64.exe", "browser_download_url": "https://example.com/app.zip"},
			{"name": "home-tunnel-linux-9.9.9-" + runtime.GOARCH + ".tar.gz", "browser_download_url": "https://example.com/app.tgz"},
			{"name": "home-tunnel-macos-9.9.9-" + runtime.GOARCH + ".tar.gz", "browser_download_url": "https://example.com/app-mac.tgz"},
		},
	})
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("content-type", "application/json")
		_, _ = writer.Write(payload)
	}))
	t.Cleanup(upstream.Close)
	previous := githubLatestRelease
	githubLatestRelease = upstream.URL
	t.Cleanup(func() { githubLatestRelease = previous })

	server := New(Options{AgentVersion: "4.0.0", StatePath: filepath.Join(t.TempDir(), "state.json")})
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/local/update", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["latest"] != "9.9.9" || body["newer"] != true {
		t.Fatalf("unexpected body %#v", body)
	}
}

func TestDownloadUpdateVerifiesSHA256(t *testing.T) {
	archive := []byte("home-tunnel-update-bytes")
	sum := sha256.Sum256(archive)
	digest := hex.EncodeToString(sum[:])
	var assetName string
	switch runtime.GOOS {
	case "windows":
		assetName = "HomeTunnel-Setup-9.9.9-x64.exe"
	case "linux":
		assetName = "home-tunnel-linux-9.9.9-" + runtime.GOARCH + ".tar.gz"
	case "darwin":
		assetName = "home-tunnel-macos-9.9.9-" + runtime.GOARCH + ".tar.gz"
	default:
		t.Skip("no packaged GUI asset")
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/latest", func(writer http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"tag_name": "v9.9.9",
			"html_url": "https://example.com/release",
			"assets": []map[string]string{
				{"name": assetName, "browser_download_url": ""},
				{"name": assetName + ".sha256", "browser_download_url": ""},
			},
		})
	})
	upstream := httptest.NewServer(mux)
	t.Cleanup(upstream.Close)
	mux.HandleFunc("/file", func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write(archive)
	})
	mux.HandleFunc("/sum", func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(digest + "  " + assetName + "\n"))
	})
	releaseJSON := map[string]any{
		"tag_name": "v9.9.9",
		"html_url": "https://example.com/release",
		"assets": []map[string]string{
			{"name": assetName, "browser_download_url": upstream.URL + "/file"},
			{"name": assetName + ".sha256", "browser_download_url": upstream.URL + "/sum"},
		},
	}
	mux.HandleFunc("/", func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/" {
			http.NotFound(writer, request)
			return
		}
		_ = json.NewEncoder(writer).Encode(releaseJSON)
	})

	previous := githubLatestRelease
	githubLatestRelease = upstream.URL + "/"
	t.Cleanup(func() { githubLatestRelease = previous })
	dir := t.TempDir()
	t.Setenv("HOME_TUNNEL_DOWNLOAD_DIR", dir)

	server := New(Options{AgentVersion: model.Version, StatePath: filepath.Join(t.TempDir(), "state.json")})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/local/update/download", nil)
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["verified"] != true {
		t.Fatalf("not verified: %#v", body)
	}
	saved := filepath.Join(dir, assetName)
	got, err := os.ReadFile(saved)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(archive) {
		t.Fatal("saved bytes mismatch")
	}
	if !strings.Contains(body["hint"].(string), saved) {
		t.Fatalf("hint missing path: %v", body["hint"])
	}
}

func TestDownloadUpdateRejectsBadChecksum(t *testing.T) {
	var assetName string
	switch runtime.GOOS {
	case "windows":
		assetName = "HomeTunnel-Setup-9.9.9-x64.exe"
	case "linux":
		assetName = "home-tunnel-linux-9.9.9-" + runtime.GOARCH + ".tar.gz"
	case "darwin":
		assetName = "home-tunnel-macos-9.9.9-" + runtime.GOARCH + ".tar.gz"
	default:
		t.Skip("no packaged GUI asset")
	}
	mux := http.NewServeMux()
	upstream := httptest.NewServer(mux)
	t.Cleanup(upstream.Close)
	mux.HandleFunc("/file", func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte("tampered"))
	})
	mux.HandleFunc("/sum", func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte("0000000000000000000000000000000000000000000000000000000000000000  " + assetName + "\n"))
	})
	mux.HandleFunc("/", func(writer http.ResponseWriter, request *http.Request) {
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"tag_name": "v9.9.9",
			"assets": []map[string]string{
				{"name": assetName, "browser_download_url": upstream.URL + "/file"},
				{"name": assetName + ".sha256", "browser_download_url": upstream.URL + "/sum"},
			},
		})
	})
	previous := githubLatestRelease
	githubLatestRelease = upstream.URL + "/"
	t.Cleanup(func() { githubLatestRelease = previous })
	dir := t.TempDir()
	t.Setenv("HOME_TUNNEL_DOWNLOAD_DIR", dir)
	server := New(Options{StatePath: filepath.Join(t.TempDir(), "state.json")})
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/local/update/download", nil))
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, assetName)); !os.IsNotExist(err) {
		t.Fatal("bad download was kept")
	}
}
