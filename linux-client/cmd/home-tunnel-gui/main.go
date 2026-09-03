package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/ZHanry/home-tunnel/linux-client/internal/desktop"
	"github.com/ZHanry/home-tunnel/linux-client/internal/gui"
	"github.com/ZHanry/home-tunnel/linux-client/internal/model"
	"github.com/ZHanry/home-tunnel/linux-client/internal/paths"
	statepkg "github.com/ZHanry/home-tunnel/linux-client/internal/state"
)

var (
	version             = model.Version
	agentVersion        = model.Version
	expectedAgentSHA256 = "development"
)

func main() {
	log.SetFlags(log.Ldate | log.Ltime | log.LUTC)
	if gui.RequestShow() {
		return
	}
	statePath := paths.DesktopStatePath()
	agentPath := paths.DesktopAgentPath()
	if err := os.MkdirAll(filepath.Dir(statePath), 0o700); err != nil {
		log.Fatal(err)
	}
	server := gui.New(gui.Options{
		StatePath:         statePath,
		AgentPath:         agentPath,
		ExpectedAgentHash: expectedAgentSHA256,
		AgentVersion:      agentVersion,
	})
	listener, err := gui.ListenLoopback()
	if err != nil {
		if gui.RequestShow() {
			return
		}
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	server.Attach(ctx)
	server.SetQuit(stop)
	host := &desktop.Host{}
	server.SetShow(host.Show)
	if state, err := (statepkg.Store{Path: statePath}).Load(); err == nil && state.Enrolled() {
		server.StartAgent(ctx)
	}
	httpServer := &http.Server{Handler: server.Handler()}
	go func() {
		if err := httpServer.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Print(err)
		}
	}()
	url := "http://" + gui.UIAddress + "/"
	log.Printf("Home Tunnel GUI %s window %s", version, url)
	go func() {
		<-ctx.Done()
		desktop.Quit()
	}()
	runErr := desktop.Run(url, host, stop)
	server.StopAgent()
	shutdown, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(shutdown)
	if runErr != nil {
		log.Fatal(runErr)
	}
}
