package app

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"log"
	"math/rand/v2"
	"net/http"
	"time"

	"github.com/ZHanry/home-tunnel/linux-client/internal/api"
	"github.com/ZHanry/home-tunnel/linux-client/internal/realtime"
)

const (
	realtimeInitialBackoff = time.Second
	realtimeMaximumBackoff = time.Minute
)

type realtimeLoopOptions struct {
	client           *api.Client
	apiBaseURL       string
	deviceID         string
	deviceCredential string
	tlsConfig        *tls.Config
	signals          chan<- struct{}
}

// runRealtimeLoop keeps a WebSocket subscription to the control center alive
// and converts every pushed business event into a synchronization signal.
// Reconnects use exponential backoff with jitter (1s doubling up to a 60s
// cap); the periodic poll in Run remains the safety net while this loop is
// down.
func runRealtimeLoop(ctx context.Context, options realtimeLoopOptions) {
	backoff := realtimeInitialBackoff
	for ctx.Err() == nil {
		established, err := subscribeRealtime(ctx, options)
		if ctx.Err() != nil {
			return
		}
		if established {
			backoff = realtimeInitialBackoff
		}
		if isUnauthorizedRealtime(err) {
			// Mirror synchronize's SESSION_REVOKED handling: one device
			// re-login, then reconnect immediately with the fresh token.
			if _, loginErr := options.client.DeviceLogin(ctx, options.deviceID, options.deviceCredential); loginErr == nil {
				log.Printf("REALTIME_RELOGIN renewed the device session after an unauthorized realtime handshake")
				continue
			} else if isRevoked(loginErr) || isCredentialInvalid(loginErr) {
				// The device cannot recover by retrying. Wake the main loop
				// so its next synchronize observes the revocation and applies
				// the existing shutdown semantics, then stop this goroutine.
				log.Printf("REALTIME_REVOKED device authentication was rejected; realtime notifications stopped: %v", loginErr)
				requestSynchronization(options.signals)
				return
			}
			// A transient re-login failure falls through to the backoff path.
		}
		delay := backoff/2 + rand.N(backoff/2)
		log.Printf("REALTIME_DISCONNECTED realtime subscription ended; reconnecting in %s: %v", delay.Round(time.Millisecond), err)
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
		backoff *= 2
		if backoff > realtimeMaximumBackoff {
			backoff = realtimeMaximumBackoff
		}
	}
}

// subscribeRealtime performs one connect-and-consume cycle. The boolean
// reports whether the subscription became established (the server confirmed
// it with a realtime.connected event), which resets the reconnect backoff.
func subscribeRealtime(ctx context.Context, options realtimeLoopOptions) (bool, error) {
	token, err := options.client.AccessToken(ctx)
	if err != nil {
		return false, err
	}
	connection, err := realtime.Dial(ctx, options.apiBaseURL, token, options.tlsConfig)
	if err != nil {
		return false, err
	}
	defer connection.Close()
	established := false
	for {
		message, err := connection.ReadEvent(ctx)
		if err != nil {
			return established, err
		}
		var envelope struct {
			Event string `json:"event"`
		}
		if err := json.Unmarshal(message, &envelope); err != nil || envelope.Event == "" {
			continue
		}
		if envelope.Event == "realtime.connected" {
			established = true
			log.Printf("REALTIME_CONNECTED realtime notifications are active")
			continue
		}
		// The control center already filters events per recipient device, so
		// any business event may affect this device's configuration.
		log.Printf("REALTIME_SYNC_TRIGGERED %q event received; synchronizing", envelope.Event)
		requestSynchronization(options.signals)
	}
}

// requestSynchronization never blocks: the signal channel has capacity one,
// so bursts of events collapse into a single pending synchronization.
func requestSynchronization(signals chan<- struct{}) {
	select {
	case signals <- struct{}{}:
	default:
	}
}

// isUnauthorizedRealtime matches a rejected WebSocket upgrade as well as a
// failed token refresh (HTTP 401 from the REST API); both mean the current
// session is no longer valid and a device re-login is required.
func isUnauthorizedRealtime(err error) bool {
	if errors.Is(err, realtime.ErrUnauthorized) {
		return true
	}
	var apiError *api.Error
	return errors.As(err, &apiError) && apiError.StatusCode == http.StatusUnauthorized
}

// tlsConfigFromHTTPClient mirrors the TLS settings of a custom HTTP client
// (tests use httptest certificates) so the WebSocket dial trusts the same
// roots as the REST calls; nil keeps the platform defaults used in
// production.
func tlsConfigFromHTTPClient(httpClient *http.Client) *tls.Config {
	if httpClient == nil {
		return nil
	}
	transport, ok := httpClient.Transport.(*http.Transport)
	if !ok || transport.TLSClientConfig == nil {
		return nil
	}
	return transport.TLSClientConfig.Clone()
}
