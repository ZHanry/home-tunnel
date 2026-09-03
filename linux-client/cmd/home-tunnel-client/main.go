package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/ZHanry/home-tunnel/linux-client/internal/api"
	"github.com/ZHanry/home-tunnel/linux-client/internal/app"
	"github.com/ZHanry/home-tunnel/linux-client/internal/model"
	statepkg "github.com/ZHanry/home-tunnel/linux-client/internal/state"
)

var (
	version             = model.Version
	agentVersion        = model.Version
	expectedAgentSHA256 = "development"
)

func main() {
	log.SetFlags(log.Ldate | log.Ltime | log.LUTC)
	if err := execute(os.Args[1:]); err != nil {
		log.Printf("error: %v", err)
		os.Exit(1)
	}
}

func execute(arguments []string) error {
	if len(arguments) == 0 {
		return usageError()
	}
	switch arguments[0] {
	case "version", "--version", "-version":
		fmt.Printf("%s %s (Agent %s)\n", productName(), version, agentVersion)
		return nil
	case "enroll":
		return enroll(arguments[1:])
	case "run":
		return run(arguments[1:])
	case "status":
		return status(arguments[1:])
	case "connection":
		return connectionCommand(arguments[1:])
	case "help", "--help", "-h":
		printUsage(os.Stdout)
		return nil
	default:
		return usageError()
	}
}

func enroll(arguments []string) error {
	flags := flag.NewFlagSet("enroll", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	statePath := flags.String("state", defaultStatePath(), "state file")
	server := flags.String("server", "", "control-center HTTPS origin")
	username := flags.String("username", "", "account username")
	deviceName := flags.String("device-name", app.DefaultDeviceName(), "device name shown in the control center")
	passwordFile := flags.String("password-file", "", "file containing the current password, or - for stdin")
	newPasswordFile := flags.String("new-password-file", "", "file containing a required replacement password")
	if err := flags.Parse(arguments); err != nil || flags.NArg() != 0 {
		return errors.New("invalid enroll arguments; run home-tunnel-client help")
	}
	if strings.TrimSpace(*server) == "" || strings.TrimSpace(*username) == "" || strings.TrimSpace(*deviceName) == "" || *passwordFile == "" {
		return errors.New("enroll requires --server, --username, --device-name and --password-file")
	}
	password, err := readSecret(*passwordFile)
	if err != nil {
		return fmt.Errorf("read password: %w", err)
	}
	var nextPassword string
	if *newPasswordFile != "" {
		if *passwordFile == "-" && *newPasswordFile == "-" {
			return errors.New("current and new passwords cannot both use the same stdin stream")
		}
		nextPassword, err = readSecret(*newPasswordFile)
		if err != nil {
			return fmt.Errorf("read new password: %w", err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	if err := app.Enroll(ctx, app.EnrollOptions{
		StatePath: *statePath, Server: *server, Username: *username,
		Password: password, NewPassword: nextPassword, DeviceName: *deviceName,
	}); err != nil {
		return err
	}
	fmt.Printf("Enrolled %s. %s\n", *deviceName, serviceStartHint())
	return nil
}

func run(arguments []string) error {
	flags := flag.NewFlagSet("run", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	statePath := flags.String("state", defaultStatePath(), "state file")
	agentPath := flags.String("agent", defaultAgentPath(), "managed Agent binary")
	if err := flags.Parse(arguments); err != nil || flags.NArg() != 0 {
		return errors.New("invalid run arguments; run home-tunnel-client help")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	err := app.Run(ctx, app.RunOptions{
		StatePath: *statePath, AgentPath: *agentPath,
		ExpectedAgentHash: expectedAgentSHA256, AgentVersion: agentVersion,
	})
	if errors.Is(err, app.ErrRevoked) {
		log.Print("account or device was revoked; the service stopped without automatic retry")
		return nil
	}
	return err
}

func connectionCommand(arguments []string) error {
	if len(arguments) == 0 {
		return errors.New("connection requires ls, add, set, or delete")
	}
	switch arguments[0] {
	case "ls", "list":
		return connectionList(arguments[1:])
	case "add":
		return connectionAdd(arguments[1:])
	case "set":
		return connectionSet(arguments[1:])
	case "delete", "rm":
		return connectionDelete(arguments[1:])
	default:
		return errors.New("connection requires ls, add, set, or delete")
	}
}

func enrolledAPI(statePath string) (*api.Client, model.State, error) {
	state, err := (statepkg.Store{Path: statePath}).Load()
	if err != nil {
		return nil, state, err
	}
	if !state.Enrolled() {
		return nil, state, errors.New("this machine is not enrolled; run home-tunnel-client enroll first")
	}
	client, err := api.New(state.Profile.APIBaseURL, nil)
	if err != nil {
		return nil, state, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if _, err := client.DeviceLogin(ctx, state.DeviceID, state.DeviceCredential); err != nil {
		return nil, state, err
	}
	return client, state, nil
}

func connectionList(arguments []string) error {
	flags := flag.NewFlagSet("connection ls", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	statePath := flags.String("state", defaultStatePath(), "state file")
	jsonOutput := flags.Bool("json", false, "print JSON")
	if err := flags.Parse(arguments); err != nil || flags.NArg() != 0 {
		return errors.New("invalid connection ls arguments")
	}
	client, _, err := enrolledAPI(*statePath)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	items, err := client.ListConnections(ctx)
	if err != nil {
		return err
	}
	if *jsonOutput {
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		return encoder.Encode(items)
	}
	if len(items) == 0 {
		fmt.Println("No connections.")
		return nil
	}
	for _, item := range items {
		target := item.PublicURL
		if target == "" {
			target = item.PublicEndpoint
		}
		fmt.Printf("%s  %s  %s  %s\n", item.ID, item.Name, target, item.State)
	}
	return nil
}

func connectionAdd(arguments []string) error {
	flags := flag.NewFlagSet("connection add", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	statePath := flags.String("state", defaultStatePath(), "state file")
	name := flags.String("name", "", "connection name")
	subdomain := flags.String("subdomain", "", "public subdomain")
	host := flags.String("local-host", "127.0.0.1", "local host")
	port := flags.Int("local-port", 0, "local port")
	scheme := flags.String("scheme", "http", "local scheme")
	disabled := flags.Bool("disabled", false, "create without enabling")
	if err := flags.Parse(arguments); err != nil || flags.NArg() != 0 {
		return errors.New("invalid connection add arguments")
	}
	if strings.TrimSpace(*name) == "" || strings.TrimSpace(*subdomain) == "" || *port < 1 || *port > 65535 {
		return errors.New("connection add requires --name, --subdomain and --local-port")
	}
	client, state, err := enrolledAPI(*statePath)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	availability, err := client.SubdomainAvailability(ctx, *subdomain)
	if err != nil {
		return err
	}
	if !availability.Available {
		if len(availability.Suggestions) > 0 {
			return fmt.Errorf("%s; suggestions: %s", availability.Message, strings.Join(availability.Suggestions, ", "))
		}
		return errors.New(availability.Message)
	}
	created, err := client.CreateHTTPConnection(ctx, state.DeviceID, *name, *subdomain, *scheme, *host, *port, !*disabled)
	if err != nil {
		return err
	}
	fmt.Printf("Created %s (%s)\n", created.Name, created.PublicURL)
	return nil
}

func connectionSet(arguments []string) error {
	flags := flag.NewFlagSet("connection set", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	statePath := flags.String("state", defaultStatePath(), "state file")
	id := flags.String("id", "", "connection id")
	enabled := flags.String("enabled", "", "true or false")
	if err := flags.Parse(arguments); err != nil || flags.NArg() != 0 {
		return errors.New("invalid connection set arguments")
	}
	if strings.TrimSpace(*id) == "" || (*enabled != "true" && *enabled != "false") {
		return errors.New("connection set requires --id and --enabled=true|false")
	}
	client, _, err := enrolledAPI(*statePath)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	items, err := client.ListConnections(ctx)
	if err != nil {
		return err
	}
	var current *model.Connection
	for index := range items {
		if items[index].ID == *id {
			current = &items[index]
			break
		}
	}
	if current == nil {
		return errors.New("connection not found")
	}
	updated, err := client.UpdateConnection(ctx, current.ID, current.Version, map[string]any{
		"enabled": *enabled == "true",
	})
	if err != nil {
		return err
	}
	fmt.Printf("Updated %s enabled=%t\n", updated.Name, updated.Enabled)
	return nil
}

func connectionDelete(arguments []string) error {
	flags := flag.NewFlagSet("connection delete", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	statePath := flags.String("state", defaultStatePath(), "state file")
	id := flags.String("id", "", "connection id")
	if err := flags.Parse(arguments); err != nil || flags.NArg() != 0 {
		return errors.New("invalid connection delete arguments")
	}
	if strings.TrimSpace(*id) == "" {
		return errors.New("connection delete requires --id")
	}
	client, _, err := enrolledAPI(*statePath)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	items, err := client.ListConnections(ctx)
	if err != nil {
		return err
	}
	var current *model.Connection
	for index := range items {
		if items[index].ID == *id {
			current = &items[index]
			break
		}
	}
	if current == nil {
		return errors.New("connection not found")
	}
	if err := client.DeleteConnection(ctx, current.ID, current.Version); err != nil {
		return err
	}
	fmt.Printf("Deleted %s\n", current.Name)
	return nil
}

func status(arguments []string) error {
	flags := flag.NewFlagSet("status", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	statePath := flags.String("state", defaultStatePath(), "state file")
	jsonOutput := flags.Bool("json", false, "print machine-readable JSON")
	if err := flags.Parse(arguments); err != nil || flags.NArg() != 0 {
		return errors.New("invalid status arguments; run home-tunnel-client help")
	}
	state, err := (statepkg.Store{Path: *statePath}).Load()
	if err != nil {
		return err
	}
	view := struct {
		Enrolled             bool       `json:"enrolled"`
		Server               string     `json:"server,omitempty"`
		DeviceID             string     `json:"device_id,omitempty"`
		AgentState           string     `json:"agent_state"`
		AgentMessage         string     `json:"agent_message"`
		LastConfigVersion    int64      `json:"last_config_version"`
		AppliedConfigVersion int64      `json:"applied_config_version"`
		LeaseExpiresAt       *time.Time `json:"lease_expires_at,omitempty"`
		ConnectionCount      int        `json:"connection_count"`
	}{
		Enrolled: state.Enrolled(), Server: state.Profile.PublicBaseURL, DeviceID: state.DeviceID,
		AgentState: state.AgentState, AgentMessage: state.AgentMessage,
		LastConfigVersion: state.LastConfigVersion, AppliedConfigVersion: state.AppliedConfigVersion,
		LeaseExpiresAt: state.LeaseExpiresAt, ConnectionCount: len(state.CachedConnections),
	}
	if *jsonOutput {
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		return encoder.Encode(view)
	}
	fmt.Printf("Enrolled: %t\n", view.Enrolled)
	fmt.Printf("Server: %s\n", valueOrDash(view.Server))
	fmt.Printf("Device: %s\n", valueOrDash(view.DeviceID))
	fmt.Printf("Agent: %s - %s\n", valueOrDash(view.AgentState), valueOrDash(view.AgentMessage))
	fmt.Printf("Configuration: applied v%d / observed v%d\n", view.AppliedConfigVersion, view.LastConfigVersion)
	if view.LeaseExpiresAt != nil {
		fmt.Printf("Lease expires: %s\n", view.LeaseExpiresAt.UTC().Format(time.RFC3339))
	}
	fmt.Printf("Connections: %d\n", view.ConnectionCount)
	return nil
}

func readSecret(path string) (string, error) {
	var reader io.Reader
	var file *os.File
	if path == "-" {
		reader = os.Stdin
	} else {
		info, err := os.Stat(path)
		if err != nil {
			return "", err
		}
		if info.Mode().Perm()&0o077 != 0 {
			return "", fmt.Errorf("secret file %s must not be accessible by group or others", path)
		}
		file, err = os.Open(path)
		if err != nil {
			return "", err
		}
		defer file.Close()
		reader = file
	}
	line, err := bufio.NewReader(io.LimitReader(reader, 4097)).ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}
	line = strings.TrimRight(line, "\r\n")
	if line == "" || len(line) > 4096 {
		return "", errors.New("secret is empty or too large")
	}
	return line, nil
}

func valueOrDash(value string) string {
	if strings.TrimSpace(value) == "" {
		return "-"
	}
	return value
}

func usageError() error {
	printUsage(os.Stderr)
	return errors.New("a command is required")
}

func printUsage(writer io.Writer) {
	fmt.Fprintln(writer, productName())
	fmt.Fprintln(writer, "")
	fmt.Fprintln(writer, "Commands:")
	fmt.Fprintln(writer, "  enroll      Discover a server and register this device")
	fmt.Fprintln(writer, "  run         Run the synchronization and Agent supervisor loop")
	fmt.Fprintln(writer, "  status      Show local service state without printing credentials")
	fmt.Fprintln(writer, "  connection  ls | add | set | delete")
	fmt.Fprintln(writer, "  version     Show client and managed Agent versions")
}
