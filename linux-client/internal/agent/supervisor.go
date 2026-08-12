package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ZHanry/home-tunnel/linux-client/internal/model"
)

type processRecord struct {
	command *exec.Cmd
	done    chan error
}

type Supervisor struct {
	operationMu     sync.Mutex
	mu              sync.Mutex
	agentPath       string
	runtimeDir      string
	expectedHash    string
	profile         model.Profile
	process         *processRecord
	stopping        bool
	applying        bool
	lastKnownGood   string
	leaseExpiry     time.Time
	restartFailures int
	nextRestart     time.Time
}

func New(agentPath, runtimeDir, expectedHash string, profile model.Profile, initialLeaseExpiry *time.Time) (*Supervisor, error) {
	if err := os.MkdirAll(runtimeDir, 0o700); err != nil {
		return nil, fmt.Errorf("create runtime directory: %w", err)
	}
	_ = os.Chmod(runtimeDir, 0o700)
	supervisor := &Supervisor{
		agentPath: agentPath, runtimeDir: runtimeDir,
		expectedHash: strings.ToLower(strings.TrimSpace(expectedHash)), profile: profile,
	}
	if initialLeaseExpiry != nil {
		supervisor.leaseExpiry = initialLeaseExpiry.UTC()
	}
	files, _ := filepath.Glob(filepath.Join(runtimeDir, "lkg-*.toml"))
	sort.Slice(files, func(left, right int) bool {
		leftInfo, leftErr := os.Stat(files[left])
		rightInfo, rightErr := os.Stat(files[right])
		if leftErr != nil || rightErr != nil {
			return files[left] > files[right]
		}
		return leftInfo.ModTime().After(rightInfo.ModTime())
	})
	if len(files) > 0 {
		supervisor.lastKnownGood = files[0]
	}
	return supervisor, nil
}

func (supervisor *Supervisor) Apply(ctx context.Context, state *model.State, syncResponse model.SyncResponse) error {
	supervisor.operationMu.Lock()
	defer supervisor.operationMu.Unlock()
	if syncResponse.Lease == nil {
		return errors.New("sync response did not include a lease")
	}
	if syncResponse.Lease.ExpiresAt.Before(time.Now().Add(time.Minute)) {
		_ = supervisor.stopProcess()
		return errors.New("lease is expired or too close to expiry")
	}
	if err := supervisor.inspectAgent(); err != nil {
		return err
	}
	configuration, err := RenderConfig(state.Profile, syncResponse)
	if err != nil {
		return err
	}
	pending, err := supervisor.writePending(configuration)
	if err != nil {
		return err
	}
	keepPending := false
	defer func() {
		if !keepPending {
			secureDelete(pending)
		}
	}()
	verifyContext, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	verify := exec.CommandContext(verifyContext, supervisor.agentPath, supervisor.arguments("verify", pending)...)
	output, err := verify.CombinedOutput()
	if err != nil {
		return fmt.Errorf("agent rejected configuration: %w: %s", err, sanitizeOutput(output))
	}

	supervisor.mu.Lock()
	previousConfig := supervisor.lastKnownGood
	previousLease := supervisor.leaseExpiry
	supervisor.mu.Unlock()
	if err := supervisor.stopProcess(); err != nil {
		return err
	}
	record, err := supervisor.start(pending, true)
	if err != nil {
		_ = supervisor.restore(previousConfig, previousLease)
		return fmt.Errorf("start agent: %w", err)
	}
	select {
	case processErr := <-record.done:
		_ = supervisor.restore(previousConfig, previousLease)
		return fmt.Errorf("agent exited during startup: %v", processErr)
	case <-time.After(3 * time.Second):
	case <-ctx.Done():
		_ = supervisor.stopProcess()
		_ = supervisor.restore(previousConfig, previousLease)
		return ctx.Err()
	}

	lkg := filepath.Join(supervisor.runtimeDir, fmt.Sprintf("lkg-%d.toml", syncResponse.TargetConfigVersion))
	if err := os.Rename(pending, lkg); err != nil {
		_ = supervisor.stopProcess()
		_ = supervisor.restore(previousConfig, previousLease)
		return fmt.Errorf("promote last-known-good configuration: %w", err)
	}
	keepPending = true
	_ = os.Chmod(lkg, 0o600)
	if previousConfig != "" && previousConfig != lkg {
		secureDelete(previousConfig)
	}
	supervisor.mu.Lock()
	supervisor.lastKnownGood = lkg
	supervisor.leaseExpiry = syncResponse.Lease.ExpiresAt
	supervisor.restartFailures = 0
	supervisor.nextRestart = time.Time{}
	supervisor.applying = false
	supervisor.mu.Unlock()
	state.AppliedConfigVersion = syncResponse.TargetConfigVersion
	state.LeaseExpiresAt = &syncResponse.Lease.ExpiresAt
	state.AgentState = "Online"
	state.AgentMessage = fmt.Sprintf("%d active connection(s)", enabledCount(syncResponse.Connections))
	for index := range state.CachedConnections {
		connection := &state.CachedConnections[index]
		connection.AppliedVersion = connection.Version
		connection.LastErrorCode = ""
		connection.LastErrorSummary = ""
		if connection.Enabled {
			connection.State = "Online"
		} else {
			connection.State = "Disabled"
		}
	}
	return nil
}

func (supervisor *Supervisor) Tick(now time.Time) (string, string) {
	supervisor.operationMu.Lock()
	defer supervisor.operationMu.Unlock()
	supervisor.mu.Lock()
	leaseExpiry := supervisor.leaseExpiry
	running := supervisor.process != nil
	lkg := supervisor.lastKnownGood
	failures := supervisor.restartFailures
	nextRestart := supervisor.nextRestart
	supervisor.mu.Unlock()
	if !leaseExpiry.IsZero() && !now.Before(leaseExpiry) {
		_ = supervisor.stopProcess()
		return "ExpiredStop", "lease expired; agent stopped"
	}
	if running {
		return "Online", "agent is running"
	}
	if lkg == "" || leaseExpiry.IsZero() {
		return "Offline", "agent has no applied configuration"
	}
	if failures > 5 {
		return "Error", "agent exceeded the automatic restart limit"
	}
	if now.Before(nextRestart) {
		return "Degraded", fmt.Sprintf("agent restart scheduled for %s", nextRestart.UTC().Format(time.RFC3339))
	}
	if err := supervisor.inspectAgent(); err != nil {
		return "RepairRequired", err.Error()
	}
	if _, err := supervisor.start(lkg, false); err != nil {
		supervisor.recordRestartFailure()
		return "Degraded", "agent restart failed: " + err.Error()
	}
	return "Online", "agent restarted"
}

func (supervisor *Supervisor) Running() bool {
	supervisor.mu.Lock()
	defer supervisor.mu.Unlock()
	return supervisor.process != nil
}

func (supervisor *Supervisor) Stop() error {
	supervisor.operationMu.Lock()
	defer supervisor.operationMu.Unlock()
	return supervisor.stopProcess()
}

func (supervisor *Supervisor) stopProcess() error {
	supervisor.mu.Lock()
	record := supervisor.process
	if record == nil {
		supervisor.applying = false
		supervisor.mu.Unlock()
		return nil
	}
	supervisor.stopping = true
	supervisor.mu.Unlock()
	_ = record.command.Process.Signal(os.Interrupt)
	select {
	case <-record.done:
	case <-time.After(8 * time.Second):
		_ = record.command.Process.Kill()
		<-record.done
	}
	supervisor.mu.Lock()
	supervisor.stopping = false
	supervisor.applying = false
	if supervisor.process == record {
		supervisor.process = nil
	}
	supervisor.mu.Unlock()
	return nil
}

func (supervisor *Supervisor) start(configPath string, applying bool) (*processRecord, error) {
	command := exec.Command(supervisor.agentPath, supervisor.arguments("run", configPath)...)
	command.Dir = supervisor.runtimeDir
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Start(); err != nil {
		return nil, err
	}
	record := &processRecord{command: command, done: make(chan error, 1)}
	supervisor.mu.Lock()
	if supervisor.process != nil {
		supervisor.mu.Unlock()
		_ = command.Process.Kill()
		_ = command.Wait()
		return nil, errors.New("agent process is already running")
	}
	supervisor.process = record
	supervisor.applying = applying
	supervisor.mu.Unlock()
	go func() {
		err := command.Wait()
		supervisor.mu.Lock()
		if supervisor.process == record {
			supervisor.process = nil
			wasApplying := supervisor.applying
			supervisor.applying = false
			if !supervisor.stopping && !wasApplying {
				supervisor.restartFailures++
				delay := time.Duration(1<<min(supervisor.restartFailures, 5)) * time.Second
				supervisor.nextRestart = time.Now().Add(delay)
				log.Printf("agent exited unexpectedly; retry %d scheduled in %s", supervisor.restartFailures, delay)
			}
		}
		supervisor.mu.Unlock()
		record.done <- err
		close(record.done)
	}()
	return record, nil
}

func (supervisor *Supervisor) restore(configPath string, leaseExpiry time.Time) error {
	if configPath == "" || leaseExpiry.Before(time.Now().Add(time.Minute)) {
		return nil
	}
	if _, err := os.Stat(configPath); err != nil {
		return nil
	}
	if _, err := supervisor.start(configPath, false); err != nil {
		return err
	}
	supervisor.mu.Lock()
	supervisor.lastKnownGood = configPath
	supervisor.leaseExpiry = leaseExpiry
	supervisor.mu.Unlock()
	return nil
}

func (supervisor *Supervisor) recordRestartFailure() {
	supervisor.mu.Lock()
	defer supervisor.mu.Unlock()
	supervisor.restartFailures++
	delay := time.Duration(1<<min(supervisor.restartFailures, 5)) * time.Second
	supervisor.nextRestart = time.Now().Add(delay)
}

func (supervisor *Supervisor) arguments(command, configPath string) []string {
	return []string{
		command, "--config", configPath,
		"--server", supervisor.profile.FRPSHost,
		"--port", strconv.Itoa(supervisor.profile.FRPSPort),
		"--domain", supervisor.profile.TunnelDomain,
	}
}

func (supervisor *Supervisor) writePending(configuration string) (string, error) {
	file, err := os.CreateTemp(supervisor.runtimeDir, "pending-*.toml")
	if err != nil {
		return "", fmt.Errorf("create pending configuration: %w", err)
	}
	path := file.Name()
	defer func() {
		if err != nil {
			file.Close()
			secureDelete(path)
		}
	}()
	if err = file.Chmod(0o600); err == nil {
		_, err = io.WriteString(file, configuration)
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return "", fmt.Errorf("write pending configuration: %w", err)
	}
	return path, nil
}

func (supervisor *Supervisor) inspectAgent() error {
	file, err := os.Open(supervisor.agentPath)
	if err != nil {
		return fmt.Errorf("open managed agent: %w", err)
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return fmt.Errorf("hash managed agent: %w", err)
	}
	actual := hex.EncodeToString(hash.Sum(nil))
	if supervisor.expectedHash != "" && supervisor.expectedHash != "development" && actual != supervisor.expectedHash {
		return fmt.Errorf("managed agent SHA-256 mismatch: got %s", actual)
	}
	return nil
}

func RenderConfig(profile model.Profile, syncResponse model.SyncResponse) (string, error) {
	if syncResponse.Lease == nil || strings.TrimSpace(syncResponse.Lease.Value) == "" {
		return "", errors.New("cannot render configuration without a lease")
	}
	var builder strings.Builder
	fmt.Fprintf(&builder, "serverAddr = %s\n", toml(profile.FRPSHost))
	fmt.Fprintf(&builder, "serverPort = %d\n", profile.FRPSPort)
	fmt.Fprintf(&builder, "user = %s\n", toml(syncResponse.DeviceID))
	builder.WriteString("loginFailExit = true\n")
	builder.WriteString("transport.tls.enable = true\n")
	builder.WriteString("transport.tls.disableCustomTLSFirstByte = true\n")
	builder.WriteString("transport.heartbeatInterval = 30\n")
	builder.WriteString("transport.heartbeatTimeout = 90\n")
	fmt.Fprintf(&builder, "metadatas.home_tunnel_lease = %s\n", toml(syncResponse.Lease.Value))
	builder.WriteString("log.to = \"console\"\n")
	builder.WriteString("log.level = \"info\"\n")
	for _, connection := range syncResponse.Connections {
		if !connection.Enabled {
			continue
		}
		proxyName := connection.ProxyName
		if strings.TrimSpace(proxyName) == "" {
			proxyName = "ht_" + strings.ReplaceAll(connection.ID, "-", "") + "_v" + strconv.FormatInt(connection.Version, 10)
		}
		builder.WriteString("\n[[proxies]]\n")
		fmt.Fprintf(&builder, "name = %s\n", toml(proxyName))
		builder.WriteString("type = \"http\"\n")
		fmt.Fprintf(&builder, "customDomains = [%s]\n", toml(connection.Subdomain+"."+profile.TunnelDomain))
		builder.WriteString("transport.useEncryption = true\n")
		builder.WriteString("transport.useCompression = true\n")
		builder.WriteString("healthCheck.type = \"tcp\"\n")
		builder.WriteString("healthCheck.timeoutSeconds = 3\n")
		builder.WriteString("healthCheck.intervalSeconds = 10\n")
		if connection.LocalScheme == "https" {
			builder.WriteString("[proxies.plugin]\n")
			builder.WriteString("type = \"http2https\"\n")
			fmt.Fprintf(&builder, "localAddr = %s\n", toml(fmt.Sprintf("%s:%d", connection.LocalHost, connection.LocalPort)))
			fmt.Fprintf(&builder, "hostHeaderRewrite = %s\n", toml(connection.LocalHost))
		} else {
			fmt.Fprintf(&builder, "localIP = %s\n", toml(connection.LocalHost))
			fmt.Fprintf(&builder, "localPort = %d\n", connection.LocalPort)
		}
	}
	return builder.String(), nil
}

func toml(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "\"", "\\\"")
	value = strings.ReplaceAll(value, "\r", "")
	value = strings.ReplaceAll(value, "\n", "")
	return "\"" + value + "\""
}

func secureDelete(path string) {
	file, err := os.OpenFile(path, os.O_WRONLY, 0)
	if err == nil {
		if info, statErr := file.Stat(); statErr == nil {
			zeroes := make([]byte, 64*1024)
			remaining := info.Size()
			for remaining > 0 {
				count := int64(len(zeroes))
				if remaining < count {
					count = remaining
				}
				_, _ = file.Write(zeroes[:count])
				remaining -= count
			}
			_ = file.Sync()
		}
		_ = file.Close()
	}
	_ = os.Remove(path)
}

func sanitizeOutput(value []byte) string {
	text := strings.TrimSpace(string(value))
	if len(text) > 512 {
		text = text[:512]
	}
	return strings.ReplaceAll(strings.ReplaceAll(text, "\r", " "), "\n", " ")
}

func enabledCount(connections []model.Connection) int {
	count := 0
	for _, connection := range connections {
		if connection.Enabled {
			count++
		}
	}
	return count
}

func min(left, right int) int {
	if left < right {
		return left
	}
	return right
}
