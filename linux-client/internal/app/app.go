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
	"sync"
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
	if err != nil && !errors.Is(err, statepkg.ErrStateDamaged) {
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
		if errors.Is(err, statepkg.ErrStateDamaged) {
			log.Printf("state file was damaged and the device credential is lost; enroll this device again: %v", err)
			return fmt.Errorf("device credential is lost; run home-tunnel-client enroll again: %w", err)
		}
		return err
	}
	if !state.Enrolled() {
		return errors.New("client is not enrolled; run home-tunnel-client enroll first")
	}
	// systemd restarts alone would replay authentication every RestartSec while
	// the control center is unreachable, so transient startup failures are
	// retried in-process with exponential backoff first.
	var profile model.Profile
	err = retryTransient(ctx, "discover control center", func() error {
		var discoverErr error
		profile, discoverErr = api.Discover(ctx, state.Profile.PublicBaseURL, options.HTTPClient)
		return discoverErr
	})
	if err != nil {
		return fmt.Errorf("rediscover control center: %w", err)
	}
	state.Profile = profile
	client, err := api.New(profile.APIBaseURL, options.HTTPClient)
	if err != nil {
		return err
	}
	err = retryTransient(ctx, "authenticate device", func() error {
		_, loginErr := client.DeviceLogin(ctx, state.DeviceID, state.DeviceCredential)
		if loginErr != nil && (isRevoked(loginErr) || isCredentialInvalid(loginErr)) {
			return permanentError{cause: loginErr}
		}
		return loginErr
	})
	if err != nil {
		var permanent permanentError
		if errors.As(err, &permanent) {
			state.AgentState = "Revoked"
			state.AgentMessage = "device authentication was rejected; enroll again after administrator review"
			saveStateLogged(store, state)
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

	// The heartbeat goroutine reads a snapshot instead of the live state so
	// synchronize/Apply (which can block the main loop for tens of seconds)
	// never delays heartbeats, and no data race exists on CachedConnections.
	var snapshotMu sync.Mutex
	snapshot := snapshotState(state)
	saveState := func() {
		snapshotMu.Lock()
		snapshot = snapshotState(state)
		snapshotMu.Unlock()
		saveStateLogged(store, state)
	}

	if state.LeaseExpiresAt != nil {
		status, message := supervisor.Tick(time.Now())
		state.AgentState = status
		state.AgentMessage = message
		saveState()
	}

	synchronize := func() error {
		retriedLogin := false
		for {
			var reportedExpiry *time.Time
			if supervisor.Running() && state.LeaseExpiresAt != nil {
				reportedExpiry = state.LeaseExpiresAt
			}
			response, syncErr := client.Sync(ctx, state.DeviceID, state.LastConfigVersion, reportedExpiry)
			if syncErr != nil {
				if isSessionRevoked(syncErr) && !retriedLogin {
					if _, loginErr := client.DeviceLogin(ctx, state.DeviceID, state.DeviceCredential); loginErr == nil {
						retriedLogin = true
						continue
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
					saveState()
					return err
				}
			}
			snapshotMu.Lock()
			snapshot = snapshotState(state)
			snapshotMu.Unlock()
			return store.Save(state)
		}
	}

	if err := synchronize(); err != nil {
		if errors.Is(err, ErrRevoked) {
			state.AgentState = "Revoked"
			state.AgentMessage = "account or device was revoked"
			saveState()
			return ErrRevoked
		}
		state.AgentState = "Degraded"
		state.AgentMessage = "initial synchronization failed: " + err.Error()
		saveState()
		log.Printf("initial synchronization failed; service will retry: %v", err)
	}

	heartbeatCtx, cancelHeartbeat := context.WithCancel(ctx)
	var heartbeatDone sync.WaitGroup
	heartbeatDone.Add(1)
	go func() {
		defer heartbeatDone.Done()
		ticker := time.NewTicker(options.HeartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-heartbeatCtx.Done():
				return
			case <-ticker.C:
				snapshotMu.Lock()
				current := snapshot
				snapshotMu.Unlock()
				if err := client.Heartbeat(heartbeatCtx, current, options.AgentVersion); err != nil {
					log.Printf("heartbeat failed: %v", err)
				}
			}
		}
	}()
	defer func() {
		cancelHeartbeat()
		heartbeatDone.Wait()
	}()

	// Realtime push: business events from the control center collapse into
	// one pending synchronization signal, so configuration changes apply in
	// seconds while the periodic poll below stays as the fallback.
	syncSignals := make(chan struct{}, 1)
	realtimeCtx, cancelRealtime := context.WithCancel(ctx)
	var realtimeDone sync.WaitGroup
	realtimeDone.Add(1)
	go func() {
		defer realtimeDone.Done()
		runRealtimeLoop(realtimeCtx, realtimeLoopOptions{
			client:           client,
			apiBaseURL:       profile.APIBaseURL,
			deviceID:         state.DeviceID,
			deviceCredential: state.DeviceCredential,
			tlsConfig:        tlsConfigFromHTTPClient(options.HTTPClient),
			signals:          syncSignals,
		})
	}()
	defer func() {
		cancelRealtime()
		realtimeDone.Wait()
	}()

	// synchronizeAndReport applies the shared failure handling for both the
	// safety poll and realtime-triggered synchronizations; a non-nil return
	// stops Run with that error.
	synchronizeAndReport := func() error {
		err := synchronize()
		if err == nil {
			return nil
		}
		if errors.Is(err, ErrRevoked) {
			_ = supervisor.Stop()
			state.AgentState = "Revoked"
			state.AgentMessage = "account or device was revoked"
			markConnections(&state, "Offline", "DEVICE_REVOKED")
			saveState()
			return ErrRevoked
		}
		state.AgentState = "Degraded"
		state.AgentMessage = "synchronization failed; current lease remains active: " + err.Error()
		saveState()
		log.Printf("synchronization failed: %v", err)
		return nil
	}

	syncTicker := time.NewTicker(options.SyncInterval)
	supervisorTicker := time.NewTicker(5 * time.Second)
	defer syncTicker.Stop()
	defer supervisorTicker.Stop()
	for {
		select {
		case <-ctx.Done():
			_ = supervisor.Stop()
			state.AgentState = "Offline"
			state.AgentMessage = "service stopped"
			saveState()
			return nil
		case <-syncTicker.C:
			if err := synchronizeAndReport(); err != nil {
				return err
			}
		case <-syncSignals:
			if err := synchronizeAndReport(); err != nil {
				return err
			}
		case now := <-supervisorTicker.C:
			status, message := supervisor.Tick(now)
			if status != state.AgentState || message != state.AgentMessage {
				state.AgentState = status
				state.AgentMessage = message
				if status == "ExpiredStop" || status == "Error" || status == "RepairRequired" {
					markConnections(&state, "Offline", strings.ToUpper(status))
				}
				saveState()
			}
		}
	}
}

// saveStateLogged persists the state and logs failures instead of silently
// dropping them; losing a save is worth noticing but must not stop the loop.
func saveStateLogged(store statepkg.Store, state model.State) {
	if err := store.Save(state); err != nil {
		log.Printf("failed to persist state: %v", err)
	}
}

// snapshotState returns a copy safe for concurrent reads: the main loop
// mutates CachedConnections elements in place, so the slice is deep-copied.
func snapshotState(state model.State) model.State {
	snapshot := state
	snapshot.CachedConnections = append([]model.Connection(nil), state.CachedConnections...)
	return snapshot
}

type permanentError struct {
	cause error
}

func (err permanentError) Error() string { return err.cause.Error() }
func (err permanentError) Unwrap() error { return err.cause }

// retryTransient retries operation with exponential backoff (5s..80s, five
// retries) unless it reports a permanentError or the context ends. It is the
// main defense against restart storms when the control center is briefly
// unavailable; the systemd unit backoff only covers very old systemd versions.
func retryTransient(ctx context.Context, description string, operation func() error) error {
	delay := 5 * time.Second
	const maximumAttempts = 6
	var err error
	for attempt := 1; ; attempt++ {
		err = operation()
		if err == nil {
			return nil
		}
		var permanent permanentError
		if errors.As(err, &permanent) || attempt >= maximumAttempts {
			return err
		}
		log.Printf("%s failed (attempt %d/%d); retrying in %s: %v", description, attempt, maximumAttempts, delay, err)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
		delay *= 2
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
