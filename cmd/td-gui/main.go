// Command td-gui serves a local web UI for td, backed by td's own HTTP API.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/madic-creates/td-gui/internal/backend"
	"github.com/madic-creates/td-gui/internal/proxy"
	"github.com/madic-creates/td-gui/internal/tdbin"
	"github.com/madic-creates/td-gui/internal/web"
)

// minTdVersion is the oldest td release td-gui is verified against. Older
// releases have `td serve` but lack available_transitions and active_review.
const minTdVersion = "v0.57.0"

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "td-gui:", err)
		os.Exit(1)
	}
}

func run() error {
	port := flag.Int("port", 0, "port for the web UI (0 = pick a free one)")
	noOpen := flag.Bool("no-open", false, "do not open a browser automatically")
	tdPath := flag.String("td", "", "path to the td binary (default: from PATH)")
	workDir := flag.String("work-dir", ".", "project directory")
	flag.Parse()

	baseDir, err := filepath.Abs(*workDir)
	if err != nil {
		return fmt.Errorf("resolve project directory: %w", err)
	}

	td, err := tdbin.Locate(*tdPath)
	if err != nil {
		return fmt.Errorf("%w — install td or set --td", err)
	}
	version, err := tdbin.Version(td)
	if err != nil {
		return err
	}
	ok, err := tdbin.AtLeast(version, minTdVersion)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("td %s is too old, %s or newer is required", version, minTdVersion)
	}

	assets, err := web.Handler()
	if err != nil {
		if errors.Is(err, web.ErrNoBuild) {
			return fmt.Errorf("%w — this binary contains no web build", err)
		}
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	mgr := backend.NewManager(backend.Config{
		BaseDir: baseDir,
		TdPath:  td,
		Stderr:  os.Stderr,
	})
	if err := mgr.Start(ctx); err != nil {
		return err
	}
	defer func() { _ = mgr.Stop() }()

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		if *port != 0 {
			return fmt.Errorf("port %d is already in use: %w", *port, err)
		}
		return fmt.Errorf("open listener: %w", err)
	}
	origin := fmt.Sprintf("http://127.0.0.1:%d", ln.Addr().(*net.TCPAddr).Port)

	api, err := proxy.New(mgr.BaseURL(), mgr.Token())
	if err != nil {
		return err
	}
	apiSwitch := proxy.NewSwitch(api)

	mgr.Supervise(ctx, func(baseURL, token string) {
		next, err := proxy.New(baseURL, token)
		if err != nil {
			fmt.Fprintln(os.Stderr, "td-gui: restarting the backend failed:", err)
			return
		}
		apiSwitch.Set(next)
		fmt.Fprintf(os.Stderr, "td-gui: backend restarted on %s\n", baseURL)
	})

	mux := http.NewServeMux()
	mux.Handle("/v1/", apiSwitch)
	mux.Handle("/health", apiSwitch)
	mux.Handle("/", assets)

	srv := &http.Server{
		Handler:      proxy.OriginGuard(origin, mux),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 0, // SSE responses stay open indefinitely
		IdleTimeout:  120 * time.Second,
	}

	fmt.Fprintf(os.Stderr, "td-gui is running on %s\n", origin)
	fmt.Fprintf(os.Stderr, "  project:  %s\n", baseDir)
	fmt.Fprintf(os.Stderr, "  td:       %s (%s)\n", td, version)
	if mgr.Owned() {
		fmt.Fprintf(os.Stderr, "  backend:  %s (started by us)\n", mgr.BaseURL())
	} else {
		fmt.Fprintf(os.Stderr, "  backend:  %s (existing instance)\n", mgr.BaseURL())
	}

	if !*noOpen {
		openBrowser(origin)
	}

	errCh := make(chan error, 1)
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case <-ctx.Done():
	case err := <-errCh:
		if err != nil {
			return err
		}
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	fmt.Fprintln(os.Stderr, "td-gui stopped")
	return nil
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	// A failure to open a browser is not a reason to fail startup; the URL is
	// already printed above.
	_ = cmd.Start()
}
