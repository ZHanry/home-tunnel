package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/ZHanry/home-tunnel/linux-client/internal/model"
)

const (
	maximumDiscoveryBytes = 32 * 1024
	maximumResponseBytes  = 2 * 1024 * 1024
)

var domainPattern = regexp.MustCompile(`(?i)^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)

type Error struct {
	StatusCode int
	Code       string
	Message    string
}

func (err *Error) Error() string {
	return fmt.Sprintf("%s: %s (HTTP %d)", err.Code, err.Message, err.StatusCode)
}

type Client struct {
	baseURL    *url.URL
	http       *http.Client
	userAgent  string
	mu         sync.Mutex
	access     string
	refresh    string
	accessEnds time.Time
}

func Discover(ctx context.Context, address string, transport *http.Client) (model.Profile, error) {
	var profile model.Profile
	requested, err := normalizeRoot(address)
	if err != nil {
		return profile, err
	}
	if transport == nil {
		transport = &http.Client{
			Timeout: 12 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		}
	}
	endpoint := requested.ResolveReference(&url.URL{Path: "/api/v1/public/config"})
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return profile, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "HomeTunnel-Linux/"+model.Version)
	response, err := transport.Do(request)
	if err != nil {
		return profile, fmt.Errorf("discover server: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode >= 300 && response.StatusCode < 400 {
		return profile, errors.New("server configuration endpoint redirected; use the final HTTPS origin")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return profile, fmt.Errorf("discover server: HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maximumDiscoveryBytes+1))
	if err != nil {
		return profile, fmt.Errorf("read server configuration: %w", err)
	}
	if len(data) == 0 || len(data) > maximumDiscoveryBytes {
		return profile, errors.New("server configuration response is empty or too large")
	}
	var value struct {
		PublicBaseURL         string `json:"public_base_url"`
		TunnelDomain          string `json:"tunnel_domain"`
		FRPSHost              string `json:"frps_host"`
		FRPSPort              int    `json:"frps_port"`
		FRPSTLSCertificatePEM string `json:"frps_tls_certificate_pem"`
	}
	if err := json.Unmarshal(data, &value); err != nil {
		return profile, fmt.Errorf("decode server configuration: %w", err)
	}
	canonical, err := normalizeRoot(value.PublicBaseURL)
	if err != nil {
		return profile, fmt.Errorf("invalid canonical server origin: %w", err)
	}
	if !sameOrigin(requested, canonical) {
		return profile, errors.New("server returned a different control-center origin; use that origin directly")
	}
	domain := strings.ToLower(strings.Trim(strings.TrimSpace(value.TunnelDomain), "."))
	if len(domain) > 253 || !domainPattern.MatchString(domain) {
		return profile, errors.New("server returned an invalid tunnel domain")
	}
	host := strings.TrimSpace(value.FRPSHost)
	if host == "" || len(host) > 253 || strings.ContainsAny(host, "\r\n\t /\\") {
		return profile, errors.New("server returned an invalid FRPS host")
	}
	if value.FRPSPort < 1 || value.FRPSPort > 65535 {
		return profile, errors.New("server returned an invalid FRPS port")
	}
	// 可选字段：服务端未配置 FRPS 证书时不出现，客户端保持历史行为。
	certificatePEM := value.FRPSTLSCertificatePEM
	if strings.TrimSpace(certificatePEM) == "" {
		certificatePEM = ""
	} else if len(certificatePEM) > 16*1024 ||
		!strings.Contains(certificatePEM, "-----BEGIN CERTIFICATE-----") ||
		!strings.Contains(certificatePEM, "-----END CERTIFICATE-----") {
		return profile, errors.New("server returned an invalid FRPS TLS certificate")
	}
	return model.Profile{
		PublicBaseURL:         canonical.String(),
		APIBaseURL:            canonical.ResolveReference(&url.URL{Path: "/api/v1/"}).String(),
		FRPSHost:              host,
		FRPSPort:              value.FRPSPort,
		TunnelDomain:          domain,
		FRPSTLSCertificatePEM: certificatePEM,
	}, nil
}

func New(baseURL string, transport *http.Client) (*Client, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return nil, errors.New("API base URL must be an absolute HTTPS URL")
	}
	if transport == nil {
		transport = &http.Client{
			Timeout: 15 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		}
	}
	return &Client{baseURL: parsed, http: transport, userAgent: "HomeTunnel-Linux/" + model.Version}, nil
}

func (client *Client) Login(ctx context.Context, username, password string) (model.Session, error) {
	client.mu.Lock()
	defer client.mu.Unlock()
	var session model.Session
	err := client.publicJSON(ctx, http.MethodPost, "auth/login", map[string]any{
		"username": username, "password": password, "client_type": "linux",
	}, &session)
	if err == nil {
		client.setSession(session.AccessToken, session.RefreshToken, session.AccessExpiresAt)
	}
	return session, err
}

func (client *Client) DeviceLogin(ctx context.Context, deviceID, credential string) (model.Session, error) {
	client.mu.Lock()
	defer client.mu.Unlock()
	var session model.Session
	err := client.publicJSON(ctx, http.MethodPost, "auth/device", map[string]any{
		"device_id": deviceID, "device_credential": credential,
	}, &session)
	if err == nil {
		client.setSession(session.AccessToken, session.RefreshToken, session.AccessExpiresAt)
	}
	return session, err
}

func (client *Client) ChangePassword(ctx context.Context, current, next string) error {
	client.mu.Lock()
	defer client.mu.Unlock()
	err := client.authJSON(ctx, http.MethodPost, "auth/password/change", map[string]any{
		"current_password": current, "new_password": next,
	}, nil)
	if err == nil {
		client.setSession("", "", time.Time{})
	}
	return err
}

func (client *Client) RegisterDevice(ctx context.Context, name, installID, fingerprint string) (model.DeviceRegistration, error) {
	client.mu.Lock()
	defer client.mu.Unlock()
	var registration model.DeviceRegistration
	err := client.authJSON(ctx, http.MethodPost, "devices/register", map[string]any{
		"name": name, "install_id": installID, "fingerprint_hash": fingerprint, "client_version": model.Version,
	}, &registration)
	return registration, err
}

func (client *Client) Sync(ctx context.Context, deviceID string, lastVersion int64, leaseExpiry *time.Time) (model.SyncResponse, error) {
	client.mu.Lock()
	defer client.mu.Unlock()
	var expiry any
	if leaseExpiry != nil {
		expiry = leaseExpiry.UTC().Format(time.RFC3339Nano)
	}
	var response model.SyncResponse
	err := client.authJSON(ctx, http.MethodPost, "client/sync", map[string]any{
		"device_id": deviceID, "last_config_version": lastVersion,
		"supports_optional_lease": true, "lease_expires_at": expiry,
		"supported_proxy_types": []string{"http", "tcp", "udp"},
	}, &response)
	return response, err
}

func (client *Client) Heartbeat(ctx context.Context, state model.State, agentVersion string) error {
	client.mu.Lock()
	defer client.mu.Unlock()
	connections := make([]map[string]any, 0, len(state.CachedConnections))
	for _, connection := range state.CachedConnections {
		connections = append(connections, map[string]any{
			"connection_id": connection.ID, "applied_version": connection.AppliedVersion,
			"state": heartbeatState(connection), "error_code": nullable(connection.LastErrorCode),
			"error_summary": nullable(connection.LastErrorSummary),
		})
	}
	return client.authJSON(ctx, http.MethodPost, "client/heartbeat", map[string]any{
		"device_id": state.DeviceID, "applied_config_version": state.AppliedConfigVersion,
		"client_version": model.Version, "agent_version": agentVersion,
		"clock_utc": time.Now().UTC().Format(time.RFC3339Nano), "connections": connections,
	}, nil)
}

func heartbeatState(connection model.Connection) string {
	switch connection.State {
	case "Disabled", "Pending", "Applying", "Online", "Degraded", "Offline", "Error":
		return connection.State
	default:
		return "Offline"
	}
}

func nullable(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

// AccessToken returns the current session access token for callers that
// attach their own Authorization header (the realtime WebSocket upgrade). It
// mirrors authJSON by refreshing the session first when the token is about to
// expire, and is safe for concurrent use.
func (client *Client) AccessToken(ctx context.Context) (string, error) {
	client.mu.Lock()
	defer client.mu.Unlock()
	if client.refresh != "" && client.accessEnds.Before(time.Now().Add(time.Minute)) {
		if err := client.refreshSession(ctx); err != nil {
			return "", err
		}
	}
	if client.access == "" {
		return "", errors.New("no active control-center session")
	}
	return client.access, nil
}

func (client *Client) authJSON(ctx context.Context, method, path string, body, target any) error {
	if client.refresh != "" && client.accessEnds.Before(time.Now().Add(time.Minute)) {
		if err := client.refreshSession(ctx); err != nil {
			return err
		}
	}
	status, err := client.sendJSON(ctx, method, path, body, target, client.access)
	if err == nil {
		return nil
	}
	var apiError *Error
	if status == http.StatusUnauthorized && client.refresh != "" && errors.As(err, &apiError) {
		if refreshErr := client.refreshSession(ctx); refreshErr != nil {
			return refreshErr
		}
		_, err = client.sendJSON(ctx, method, path, body, target, client.access)
	}
	return err
}

func (client *Client) refreshSession(ctx context.Context) error {
	var response struct {
		AccessToken     string    `json:"access_token"`
		RefreshToken    string    `json:"refresh_token"`
		AccessExpiresAt time.Time `json:"access_expires_at"`
	}
	if err := client.publicJSON(ctx, http.MethodPost, "auth/refresh", map[string]any{
		"refresh_token": client.refresh, "client_type": "linux",
	}, &response); err != nil {
		return err
	}
	client.setSession(response.AccessToken, response.RefreshToken, response.AccessExpiresAt)
	return nil
}

func (client *Client) publicJSON(ctx context.Context, method, path string, body, target any) error {
	_, err := client.sendJSON(ctx, method, path, body, target, "")
	return err
}

func (client *Client) sendJSON(ctx context.Context, method, path string, body, target any, token string) (int, error) {
	var payload io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return 0, err
		}
		payload = bytes.NewReader(data)
	}
	endpoint := client.baseURL.ResolveReference(&url.URL{Path: path})
	request, err := http.NewRequestWithContext(ctx, method, endpoint.String(), payload)
	if err != nil {
		return 0, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", client.userAgent)
	request.Header.Set("X-Request-Id", requestID())
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := client.http.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, maximumResponseBytes+1))
	if err != nil {
		return response.StatusCode, err
	}
	if len(data) > maximumResponseBytes {
		return response.StatusCode, errors.New("control-center response is too large")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var apiError struct {
			Code    string `json:"error_code"`
			Message string `json:"message"`
		}
		_ = json.Unmarshal(data, &apiError)
		if apiError.Code == "" {
			apiError.Code = "HTTP_ERROR"
		}
		if apiError.Message == "" {
			apiError.Message = http.StatusText(response.StatusCode)
		}
		return response.StatusCode, &Error{StatusCode: response.StatusCode, Code: apiError.Code, Message: apiError.Message}
	}
	if target != nil && len(data) > 0 {
		if err := json.Unmarshal(data, target); err != nil {
			return response.StatusCode, fmt.Errorf("decode control-center response: %w", err)
		}
	}
	return response.StatusCode, nil
}

func (client *Client) setSession(access, refresh string, expiry time.Time) {
	client.access = access
	client.refresh = refresh
	client.accessEnds = expiry
}

func normalizeRoot(value string) (*url.URL, error) {
	input := strings.TrimSpace(value)
	if !strings.Contains(input, "://") {
		input = "https://" + input
	}
	parsed, err := url.Parse(input)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return nil, errors.New("server address must be an HTTPS root origin")
	}
	if parsed.Scheme != "https" {
		return nil, errors.New("server address must use HTTPS")
	}
	parsed.Path = "/"
	parsed.RawPath = ""
	return parsed, nil
}

func sameOrigin(left, right *url.URL) bool {
	return strings.EqualFold(left.Scheme, right.Scheme) && strings.EqualFold(left.Hostname(), right.Hostname()) && effectivePort(left) == effectivePort(right)
}

func effectivePort(value *url.URL) string {
	if value.Port() != "" {
		return value.Port()
	}
	if value.Scheme == "https" {
		return "443"
	}
	return "80"
}

func requestID() string {
	data := make([]byte, 16)
	if _, err := rand.Read(data); err != nil {
		return fmt.Sprintf("linux-%d", time.Now().UnixNano())
	}
	data[6] = (data[6] & 0x0f) | 0x40
	data[8] = (data[8] & 0x3f) | 0x80
	hexValue := hex.EncodeToString(data)
	return hexValue[0:8] + "-" + hexValue[8:12] + "-" + hexValue[12:16] + "-" + hexValue[16:20] + "-" + hexValue[20:]
}
