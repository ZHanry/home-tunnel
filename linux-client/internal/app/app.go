package app

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ZHanry/home-tunnel/linux-client/internal/agent"
	"github.com/ZHanry/home-tunnel/linux-client/internal/api"
	"github.com/ZHanry/home-tunnel/linux-client/internal/model"
	statepkg "github.com/ZHanry/home-tunnel/linux-client/internal/state"
)

var ErrRevoked = errors.New("account or device was revoked")

type EnrollOptions struct {
	StatePath   string
	Server      string
	Username    string
	Password    string
	NewPassword string
	DeviceName  string
	HTTPClient  *http.Client
}

type RunOptions struct {
	StatePath         string
	AgentPath         string
	ExpectedAgentHash string
	AgentVersion      string
	HTTPClient        *http.Client
	SyncInterval      time.Duration
	HeartbeatInterval time.Duration
}

func Enroll(ctx context.Context, options EnrollOptions) error {
	store := statepkg.Store{Path: options.StatePath}
	state, err := store.Load()
	if err != nil && !strings.Contains(err.Error(), "preserved as") {
		return err
	}
	if state.Enrolled() {
		return errors.New("this state directory is already enrolled; revoke or move the existing state before enrolling again")
	}
	profile, err := api.Discover(ctx, options.Server, options.HTTPClient)
	if err != nil {
		return err
	}
	client, err := api.New(profile.APIBaseURL, options.HTTPClient)
	if err != nil {
		return err
	}
	session, err := client.Login(ctx, options.Username, options.Password)
	if err != nil {
		return err
	}
	if session.PasswordChangeRequired {
		if strings.TrimSpace(options.NewPassword) == "" {
			return errors.New("the account requires a password change; provide --new-password-file")
		}
		if err := client.ChangePassword(ctx, options.Password, options.NewPassword); err != nil {
			return fmt.Errorf("change initial password: %w", err)
		}
		session, err = client.Login(ctx, options.Username, options.NewPassword)
		if err != nil {
			return fmt.Errorf("sign in after password change: %w", err)
		}
		if session.PasswordChangeRequired {
			return errors.New("server still requires a password change after updating it")
		}
	}
	fingerprint, err := statepkg.Fingerprint(state.InstallID)
	if err != nil {
		return err
	}
	registration, err := client.RegisterDevice(ctx, options.DeviceName, state.InstallID, fingerprint)
	if err != nil {
		return fmt.Errorf("register Linux device: %w", err)
	}
	state.Profile = profile
	state.DeviceID = registration.DeviceID
	state.DeviceCredential = registration.DeviceCredential
	state.LastConfigVersion = 0
	state.AppliedConfigVersion = 0
	state.CachedConnections = nil
	state.LeaseExpiresAt = nil
	state.AgentState = "Offline"
	state.AgentMessage = "enrolled; waiting for the service to start"
	if err := store.Save(state); err != nil {
		return fmt.Errorf("save enrolled device credential: %w", err)
	}
	return nil
}

func Run(ctx context.Context, options RunOptions) error {
	if options.SyncInterval <= 0 {
		options.SyncInterval = 3 * time.Minute
	}
	if options.HeartbeatInterval <= 0 {
		options.HeartbeatInterval = 30 * time.Second
	}
	store := statepkg.Store{Path: options.StatePath}
	state, err := store.Load()
	if err != nil {
		return err
	}
	if !state.Enrolled() {
		return errors.New("client is not enrolled; run home-tunnel-client enroll first")
	}
	profile, err := api.Discover(ctx, state.Profile.PublicBaseURL, options.HTTPClient)
	if err != nil {
		return fmt.Errorf("rediscover control center: %w", err)
	}
	state.Profile = profile
	client, err := api.New(profile.APIBaseURL, options.HTTPClient)
	if err != nil {
		return err
	}
	if _, err := client.DeviceLogin(ctx, state.DeviceID, state.DeviceCredential); err != nil {
		if isRevoked(err) || isCredentialInvalid(err) {
			state.AgentState = "Revoked"
			state.AgentMessage = "device authentication was rejected; enroll again after administrator review"
			_ = store.Save(state)
			return ErrRevoked
		}
		return fmt.Errorf("authenticate device: %w", err)
	}
	runtimeDirectory := filepath.Join(filepath.Dir(options.StatePath), "runtime")
	supervisor, err := agent.New(options.AgentPath, runtimeDirectory, options.ExpectedAgentHash, profile, state.LeaseExpiresAt)
	if err != nil {
		return err
	}
	defer supervisor.Stop()
	if state.LeaseExpiresAt != nil {
		status, message := supervisor.Tick(time.Now())
		state.AgentState = status
		state.AgentMessage = message
		_ = store.Save(state)
	}

	synchronize := func() error {
		var reportedExpiry *time.Time
		if supervisor.Running() && state.LeaseExpiresAt != nil {
			reportedExpiry = state.LeaseExpiresAt
		}
		response, syncErr := client.Sync(ctx, state.DeviceID, state.LastConfigVersion, reportedExpiry)
		if syncErr != nil {
			if isSessionRevoked(syncErr) {
				if _, loginErr := client.DeviceLogin(ctx, state.DeviceID, state.DeviceCredential); loginErr == nil {
					return fmt.Errorf("session refreshed by device login; retrying on next cycle: %w", syncErr)
				} else if isRevoked(loginErr) || isCredentialInvalid(loginErr) {
					return ErrRevoked
				}
			}
			if isRevoked(syncErr) {
				return ErrRevoked
			}
			return syncErr
		}
		if response.FullSync {
			state.CachedConnections = response.Connections
			state.LastConfigVersion = response.TargetConfigVersion
		}
		complete := response
		complete.Connections = state.CachedConnections
		needsLease := !supervisor.Running() || state.LeaseExpiresAt == nil || state.LeaseExpiresAt.Before(time.Now().Add(15*time.Minute))
		if response.FullSync || needsLease {
			if response.Lease == nil {
				return errors.New("control center omitted the lease required to apply configuration")
			}
			if err := supervisor.Apply(ctx, &state, complete); err != nil {
				state.AgentState = "Error"
				state.AgentMessage = err.Error()
				markConnections(&state, "Error", "AGENT_APPLY_FAILED")
				_ = store.Save(state)
				return err
			}
		}
		return store.Save(state)
	}

	if err := synchronize(); err != nil {
		if errors.Is(err, ErrRevoked) {
			state.AgentState = "Revoked"
			state.AgentMessage = "account or device was revoked"
			_ = store.Save(state)
			return ErrRevoked
		}
		state.AgentState = "Degraded"
		state.AgentMessage = "initial synchronization failed: " + err.Error()
		_ = store.Save(state)
		log.Printf("initial synchronization failed; service will retry: %v", err)
	}

	syncTicker := time.NewTicker(options.SyncInterval)
	heartbeatTicker := time.NewTicker(options.HeartbeatInterval)
	supervisorTicker := time.NewTicker(5 * time.Second)
	defer syncTicker.Stop()
	defer heartbeatTicker.Stop()
	defer supervisorTicker.Stop()
	for {
		select {
		case <-ctx.Done():
			_ = supervisor.Stop()
			state.AgentState = "Offline"
			state.AgentMessage = "service stopped"
			_ = store.Save(state)
			return nil
		case <-syncTicker.C:
			if err := synchronize(); err != nil {
				if errors.Is(err, ErrRevoked) {
					_ = supervisor.Stop()
					state.AgentState = "Revoked"
					state.AgentMessage = "account or device was revoked"
					markConnections(&state, "Offline", "DEVICE_REVOKED")
					_ = store.Save(state)
					return ErrRevoked
				}
				state.AgentState = "Degraded"
				state.AgentMessage = "synchronization failed; current lease remains active: " + err.Error()
				_ = store.Save(state)
				log.Printf("synchronization failed: %v", err)
			}
		case <-heartbeatTicker.C:
			if err := client.Heartbeat(ctx, state, options.AgentVersion); err != nil {
				log.Printf("heartbeat failed: %v", err)
			}
		case now := <-supervisorTicker.C:
			status, message := supervisor.Tick(now)
			if status != state.AgentState || message != state.AgentMessage {
				state.AgentState = status
				state.AgentMessage = message
				if status == "ExpiredStop" || status == "Error" || status == "RepairRequired" {
					markConnections(&state, "Offline", strings.ToUpper(status))
				}
				_ = store.Save(state)
			}
		}
	}
}

func isSessionRevoked(err error) bool {
	var apiError *api.Error
	return errors.As(err, &apiError) && apiError.Code == "SESSION_REVOKED"
}

func isRevoked(err error) bool {
	var apiError *api.Error
	return errors.As(err, &apiError) && (apiError.Code == "DEVICE_REVOKED" || apiError.Code == "USER_DISABLED")
}

func isCredentialInvalid(err error) bool {
	var apiError *api.Error
	return errors.As(err, &apiError) && apiError.Code == "AUTH_INVALID"
}

func markConnections(state *model.State, connectionState, errorCode string) {
	for index := range state.CachedConnections {
		if !state.CachedConnections[index].Enabled {
			state.CachedConnections[index].State = "Disabled"
			continue
		}
		state.CachedConnections[index].State = connectionState
		state.CachedConnections[index].LastErrorCode = errorCode
		state.CachedConnections[index].LastErrorSummary = "managed Linux agent is not online"
	}
}

func DefaultDeviceName() string {
	name, err := os.Hostname()
	if err != nil || strings.TrimSpace(name) == "" {
		return "Linux device"
	}
	return name
}
