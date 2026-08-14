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
	port := flag.Int("port", 0, "Port für die Oberfläche (0 = frei wählen)")
	noOpen := flag.Bool("no-open", false, "Browser nicht automatisch öffnen")
	tdPath := flag.String("td", "", "Pfad zum td-Binary (Standard: aus PATH)")
	workDir := flag.String("work-dir", ".", "Projektverzeichnis")
	flag.Parse()

	baseDir, err := filepath.Abs(*workDir)
	if err != nil {
		return fmt.Errorf("Projektverzeichnis auflösen: %w", err)
	}

	td, err := tdbin.Locate(*tdPath)
	if err != nil {
		return fmt.Errorf("%w — td installieren oder --td setzen", err)
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
		return fmt.Errorf("td %s ist zu alt, mindestens %s wird benötigt", version, minTdVersion)
	}

	assets, err := web.Handler()
	if err != nil {
		if errors.Is(err, web.ErrNoBuild) {
			return fmt.Errorf("%w — dieses Binary enthält kein Web-Build", err)
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
	defer mgr.Stop()

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		if *port != 0 {
			return fmt.Errorf("Port %d ist belegt: %w", *port, err)
		}
		return fmt.Errorf("Listener öffnen: %w", err)
	}
	origin := fmt.Sprintf("http://127.0.0.1:%d", ln.Addr().(*net.TCPAddr).Port)

	api, err := proxy.New(mgr.BaseURL(), mgr.Token())
	if err != nil {
		return err
	}

	mux := http.NewServeMux()
	mux.Handle("/v1/", api)
	mux.Handle("/health", api)
	mux.Handle("/", assets)

	srv := &http.Server{
		Handler:      proxy.OriginGuard(origin, mux),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 0, // SSE responses stay open indefinitely
		IdleTimeout:  120 * time.Second,
	}

	fmt.Fprintf(os.Stderr, "td-gui läuft auf %s\n", origin)
	fmt.Fprintf(os.Stderr, "  Projekt:  %s\n", baseDir)
	fmt.Fprintf(os.Stderr, "  td:       %s (%s)\n", td, version)
	if mgr.Owned() {
		fmt.Fprintf(os.Stderr, "  Backend:  %s (selbst gestartet)\n", mgr.BaseURL())
	} else {
		fmt.Fprintf(os.Stderr, "  Backend:  %s (vorhandene Instanz)\n", mgr.BaseURL())
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
	fmt.Fprintln(os.Stderr, "td-gui beendet")
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
