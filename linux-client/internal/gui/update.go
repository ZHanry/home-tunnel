package gui

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/ZHanry/home-tunnel/linux-client/internal/model"
)

var githubLatestRelease = "https://api.github.com/repos/ZHanry/home-tunnel/releases/latest"

type githubRelease struct {
	TagName string `json:"tag_name"`
	HTMLURL string `json:"html_url"`
	Assets  []struct {
		Name string `json:"name"`
		URL  string `json:"browser_download_url"`
	} `json:"assets"`
}

func currentVersion(options Options) string {
	if options.AgentVersion != "" && options.AgentVersion != "development" {
		return options.AgentVersion
	}
	return model.Version
}

func fetchLatestRelease(request *http.Request) (githubRelease, error) {
	var payload githubRelease
	req, err := http.NewRequestWithContext(request.Context(), http.MethodGet, githubLatestRelease, nil)
	if err != nil {
		return payload, err
	}
	req.Header.Set("User-Agent", "HomeTunnel-GUI/"+model.Version)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return payload, err
	}
	defer resp.Body.Close()
	err = json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&payload)
	return payload, err
}

func packageAsset(release githubRelease) (name, url, checksumURL string) {
	latest := strings.TrimPrefix(release.TagName, "v")
	want := map[string]string{
		"windows": "HomeTunnel-Windows-" + latest + "-x64.zip",
		"linux":   "home-tunnel-linux-" + latest + "-" + runtime.GOARCH + ".tar.gz",
		"darwin":  "home-tunnel-macos-" + latest + "-" + runtime.GOARCH + ".tar.gz",
	}[runtime.GOOS]
	if want == "" {
		return "", "", ""
	}
	for _, asset := range release.Assets {
		if asset.Name == want {
			url = asset.URL
			name = asset.Name
		}
		if asset.Name == want+".sha256" || asset.Name == "SHA256SUMS.txt" {
			checksumURL = asset.URL
		}
	}
	return name, url, checksumURL
}

func (server *Server) update(writer http.ResponseWriter, request *http.Request) {
	current := currentVersion(server.options)
	release, err := fetchLatestRelease(request)
	if err != nil {
		writeJSON(writer, map[string]any{"current": current, "latest": current, "newer": false})
		return
	}
	latest := strings.TrimPrefix(release.TagName, "v")
	if latest == "" {
		latest = current
	}
	name, url, checksumURL := packageAsset(release)
	writeJSON(writer, map[string]any{
		"current":      current,
		"latest":       latest,
		"newer":        latest != current,
		"url":          release.HTMLURL,
		"asset":        name,
		"download_url": url,
		"checksum_url": checksumURL,
	})
}

func (server *Server) downloadUpdate(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writer.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	release, err := fetchLatestRelease(request)
	if err != nil {
		writeError(writer, http.StatusBadGateway, "无法读取 GitHub Release")
		return
	}
	name, url, checksumURL := packageAsset(release)
	if url == "" {
		writeError(writer, http.StatusNotFound, "当前系统没有对应的更新包，请打开 Release 页面手动下载")
		return
	}
	destinationDir := updateDownloadDir()
	if err := os.MkdirAll(destinationDir, 0o755); err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	destination := filepath.Join(destinationDir, name)
	file, err := os.Create(destination)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	req, err := http.NewRequestWithContext(request.Context(), http.MethodGet, url, nil)
	if err != nil {
		file.Close()
		_ = os.Remove(destination)
		writeError(writer, http.StatusBadGateway, err.Error())
		return
	}
	req.Header.Set("User-Agent", "HomeTunnel-GUI/"+model.Version)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		file.Close()
		_ = os.Remove(destination)
		writeError(writer, http.StatusBadGateway, err.Error())
		return
	}
	sum := sha256.New()
	_, copyErr := io.Copy(file, io.TeeReader(io.LimitReader(resp.Body, 200<<20), sum))
	resp.Body.Close()
	closeErr := file.Close()
	if copyErr != nil {
		_ = os.Remove(destination)
		writeError(writer, http.StatusBadGateway, copyErr.Error())
		return
	}
	if closeErr != nil {
		_ = os.Remove(destination)
		writeError(writer, http.StatusInternalServerError, closeErr.Error())
		return
	}
	actual := hex.EncodeToString(sum.Sum(nil))
	expected := ""
	if checksumURL != "" {
		expected = fetchChecksum(request, checksumURL, name)
	}
	if expected != "" && !strings.EqualFold(expected, actual) {
		_ = os.Remove(destination)
		writeError(writer, http.StatusBadGateway, "SHA-256 与发布清单不一致，文件已删除")
		return
	}
	exe, _ := os.Executable()
	writeJSON(writer, map[string]any{
		"path":     destination,
		"sha256":   actual,
		"verified": expected != "",
		"hint":     fmt.Sprintf("已保存到 %s。解压后覆盖 %s 所在目录里的文件，再重新打开客户端。", destination, filepath.Dir(exe)),
	})
}

func updateDownloadDir() string {
	if dir := strings.TrimSpace(os.Getenv("HOME_TUNNEL_DOWNLOAD_DIR")); dir != "" {
		return dir
	}
	home, _ := os.UserHomeDir()
	destinationDir := filepath.Join(home, "Downloads")
	if runtime.GOOS == "windows" {
		if userProfile := os.Getenv("USERPROFILE"); userProfile != "" {
			destinationDir = filepath.Join(userProfile, "Downloads")
		}
	}
	return destinationDir
}

func parseChecksum(text, assetName string) string {
	for _, line := range strings.Split(text, "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && (fields[1] == assetName || strings.HasSuffix(fields[1], assetName)) {
			return strings.TrimPrefix(fields[0], "SHA256:")
		}
	}
	if len(strings.Fields(text)) == 1 {
		return strings.TrimSpace(text)
	}
	return ""
}

func fetchChecksum(request *http.Request, checksumURL, assetName string) string {
	req, err := http.NewRequestWithContext(request.Context(), http.MethodGet, checksumURL, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("User-Agent", "HomeTunnel-GUI/"+model.Version)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return ""
	}
	return parseChecksum(string(body), assetName)
}
