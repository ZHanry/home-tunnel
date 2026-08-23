package model

import (
	"encoding/json"
	"time"
)

const Version = "3.2.0"
const CurrentSyncCapabilityVersion = 1

type Profile struct {
	PublicBaseURL string `json:"public_base_url"`
	APIBaseURL    string `json:"api_base_url"`
	FRPSHost      string `json:"frps_host"`
	FRPSPort      int    `json:"frps_port"`
	TunnelDomain  string `json:"tunnel_domain"`
	// FRPSTLSCertificatePEM 是服务端下发的 FRPS 自签证书 PEM；旧 state.json
	// 没有该字段时为空字符串，客户端保持历史行为（不固定信任锚）。
	FRPSTLSCertificatePEM string `json:"frps_tls_certificate_pem,omitempty"`
}

type User struct {
	ID            string `json:"id"`
	Username      string `json:"username"`
	DisplayName   string `json:"display_name"`
	Role          string `json:"role"`
	PasswordState string `json:"password_state"`
}

type Session struct {
	User                   User      `json:"user"`
	PasswordChangeRequired bool      `json:"password_change_required"`
	DeviceID               string    `json:"device_id"`
	AccessToken            string    `json:"access_token"`
	RefreshToken           string    `json:"refresh_token"`
	AccessExpiresAt        time.Time `json:"access_expires_at"`
	RefreshExpiresAt       time.Time `json:"refresh_expires_at"`
}

type DeviceRegistration struct {
	DeviceID         string `json:"device_id"`
	DeviceCredential string `json:"device_credential"`
	ConfigVersion    int64  `json:"config_version"`
}

type Connection struct {
	ID               string   `json:"id"`
	DeviceID         string   `json:"device_id"`
	Name             string   `json:"name"`
	Subdomain        string   `json:"subdomain"`
	ProxyType        string   `json:"proxy_type"`
	RemotePort       int      `json:"remote_port"`
	PublicURL        string   `json:"public_url"`
	PublicEndpoint   string   `json:"public_endpoint"`
	CustomDomains    []string `json:"custom_domains"`
	LocalScheme      string   `json:"local_scheme"`
	LocalHost        string   `json:"local_host"`
	LocalPort        int      `json:"local_port"`
	Enabled          bool     `json:"enabled"`
	Version          int64    `json:"version"`
	State            string   `json:"state"`
	AppliedVersion   int64    `json:"applied_version"`
	LastErrorCode    string   `json:"last_error_code,omitempty"`
	LastErrorSummary string   `json:"-"`
	ProxyName        string   `json:"proxy_name,omitempty"`
}

// UnmarshalJSON reads the protocol-neutral remote_port field while retaining
// compatibility with control centers that still send tcp_remote_port. When
// both are present, the canonical field always wins, including an explicit 0.
func (connection *Connection) UnmarshalJSON(data []byte) error {
	type connectionAlias Connection
	var wire struct {
		connectionAlias
		RemotePort       *int `json:"remote_port"`
		LegacyRemotePort *int `json:"tcp_remote_port"`
	}
	if err := json.Unmarshal(data, &wire); err != nil {
		return err
	}
	*connection = Connection(wire.connectionAlias)
	if wire.RemotePort != nil {
		connection.RemotePort = *wire.RemotePort
	} else if wire.LegacyRemotePort != nil {
		connection.RemotePort = *wire.LegacyRemotePort
	}
	return nil
}

type Lease struct {
	Value         string    `json:"lease"`
	ExpiresAt     time.Time `json:"expires_at"`
	ConfigVersion int64     `json:"config_version"`
}

type SyncResponse struct {
	DeviceID            string       `json:"device_id"`
	FullSync            bool         `json:"full_sync"`
	TargetConfigVersion int64        `json:"target_config_version"`
	Connections         []Connection `json:"connections"`
	ContentHash         string       `json:"content_hash"`
	Lease               *Lease       `json:"lease"`
	ServerTime          time.Time    `json:"server_time"`
}

type State struct {
	InstallID             string       `json:"install_id"`
	Profile               Profile      `json:"profile"`
	DeviceID              string       `json:"device_id"`
	DeviceCredential      string       `json:"device_credential"`
	LastConfigVersion     int64        `json:"last_config_version"`
	SyncCapabilityVersion int          `json:"sync_capability_version"`
	AppliedConfigVersion  int64        `json:"applied_config_version"`
	CachedConnections     []Connection `json:"cached_connections"`
	LeaseExpiresAt        *time.Time   `json:"lease_expires_at,omitempty"`
	AgentState            string       `json:"agent_state"`
	AgentMessage          string       `json:"agent_message"`
	UpdatedAt             time.Time    `json:"updated_at"`
}

// SyncRequestConfigVersion forces one full synchronization after a client
// capability upgrade. State files written before the marker was introduced
// decode as version 0 and therefore cannot retain capability-filtered caches.
func (state State) SyncRequestConfigVersion() int64 {
	if state.SyncCapabilityVersion < CurrentSyncCapabilityVersion {
		return 0
	}
	return state.LastConfigVersion
}

func (state State) Enrolled() bool {
	return state.InstallID != "" && state.DeviceID != "" && state.DeviceCredential != "" &&
		state.Profile.PublicBaseURL != "" && state.Profile.APIBaseURL != ""
}
