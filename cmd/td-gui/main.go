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
	"github.com/madic-creates/td-gui/internal/tdquery"
	"github.com/madic-creates/td-gui/internal/web"
)

// minTdVersion is the oldest td release td-gui is verified against. Older
// releases have `td serve` but lack available_transitions and active_review.
const minTdVersion = "v0.57.0"

// buildVersion is stamped by the release job via
// -ldflags "-X main.buildVersion=v1.2.3". Every other build reports "dev".
var buildVersion = "dev"

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
	showVersion := flag.Bool("version", false, "print the td-gui version and exit")
	flag.Parse()

	// Answered before td is located, so --version works on a machine that has
	// no td installed yet.
	if *showVersion {
		fmt.Println("td-gui", buildVersion)
		return nil
	}

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
	if err := checkMinVersion(version); err != nil {
		return err
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
		return listenError(*port, err)
	}
	origin := fmt.Sprintf("http://127.0.0.1:%d", ln.Addr().(*net.TCPAddr).Port)

	api, err := proxy.New(mgr.BaseURL(), mgr.Token(), proxy.WithErrorLog(os.Stderr))
	if err != nil {
		return err
	}
	apiSwitch := proxy.NewSwitch(api)

	mgr.Supervise(ctx, func(baseURL, token string) {
		next, err := proxy.New(baseURL, token, proxy.WithErrorLog(os.Stderr))
		if err != nil {
			fmt.Fprintln(os.Stderr, "td-gui: restarting the backend failed:", err)
			return
		}
		apiSwitch.Set(next)
		fmt.Fprintf(os.Stderr, "td-gui: backend restarted on %s\n", baseURL)
	})

	mux := newMux(assets, apiSwitch, td, baseDir)

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

	if err := serve(ctx, ln, proxy.OriginGuard(origin, mux)); err != nil {
		return err
	}
	fmt.Fprintln(os.Stderr, "td-gui stopped")
	return nil
}

// newMux routes the three things td-gui serves.
//
// /v1/ and /health are td's, forwarded to td serve untouched. /gui/ is
// td-gui's own: today only the TDQ query route, which needs a subprocess
// because td serve v0.57.0 answers no query of any kind. The prefix says
// honestly which half of the surface a caller is on, and marks what gets
// deleted once td grows the endpoint itself.
//
// OriginGuard wraps the result at the call site, so every route here is
// covered by it.
func newMux(assets, api http.Handler, td, baseDir string) *http.ServeMux {
	mux := http.NewServeMux()
	mux.Handle("/v1/", api)
	mux.Handle("/health", api)
	mux.Handle("/gui/query", tdquery.Handler(td, baseDir))
	mux.Handle("/", assets)
	return mux
}

// checkMinVersion rejects a td older than minTdVersion. Split out of run() so
// the version gate — and its exact wording, which is the only clue an
// operator on an old td gets — has a test that doesn't need a real td binary
// on PATH.
func checkMinVersion(version string) error {
	ok, err := tdbin.AtLeast(version, minTdVersion)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("td %s is too old, %s or newer is required", version, minTdVersion)
	}
	return nil
}

// listenError turns a failed net.Listen into the message run() returns. The
// specific "already in use" wording is only accurate for EADDRINUSE — a
// requested port can also fail to bind on permission (e.g. a privileged port
// without root) or on an invalid address, and blaming those on "in use" would
// send an operator looking in the wrong place. port == 0 means "pick any
// free port", so a failure there is never about a specific port being taken.
func listenError(port int, err error) error {
	if port == 0 {
		return fmt.Errorf("open listener: %w", err)
	}
	if errors.Is(err, syscall.EADDRINUSE) {
		return fmt.Errorf("port %d is already in use: %w", port, err)
	}
	return fmt.Errorf("open listener on port %d: %w", port, err)
}

// serve runs handler on ln until ctx is cancelled or Serve fails, then shuts
// the server down.
//
// Request contexts descend from BaseContext, so cancelling connCtx below is
// what makes shutdown immediate — see the comment at the Shutdown call.
func serve(ctx context.Context, ln net.Listener, handler http.Handler) error {
	connCtx, cancelConns := context.WithCancel(context.Background())
	defer cancelConns()

	srv := &http.Server{
		Handler:      handler,
		BaseContext:  func(net.Listener) context.Context { return connCtx },
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 0, // SSE responses stay open indefinitely
		IdleTimeout:  120 * time.Second,
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

	// Shutdown waits for in-flight handlers and never cancels their contexts,
	// and the UI always holds td's SSE endpoint open, so Shutdown on its own
	// blocks for the full timeout. Worse, td serve is being stopped in the same
	// breath and waits out its own grace period for that same stream, so Ctrl-C
	// cost about ten seconds. Cancelling connCtx propagates to every in-flight
	// request context, which tears the proxied stream down at once; nothing else
	// this server answers is long-lived, so there is no drain worth waiting for.
	cancelConns()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		_ = srv.Close()
	}
	return nil
}

func openBrowser(url string) {
	// A failure to open a browser, or the browser process itself failing, is
	// not a reason to fail startup; the URL is already printed above. The
	// returned channel is intentionally unused: nothing here needs to know
	// when the browser process exits, only that it eventually gets reaped.
	_, _ = startAndReap(browserCommand(url))
}

func browserCommand(url string) *exec.Cmd {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", url)
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		return exec.Command("xdg-open", url)
	}
}

// startAndReap starts cmd and waits for it on its own goroutine, so a process
// that exits before td-gui does is reaped immediately instead of sitting as a
// zombie until td-gui's own exit reparents and clears it. The returned
// channel closes once the wait completes.
func startAndReap(cmd *exec.Cmd) (<-chan struct{}, error) {
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	done := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(done)
	}()
	return done, nil
}
