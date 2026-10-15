//go:build !windows

package contract

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/madic-creates/td-gui/internal/backend"
	"github.com/madic-creates/td-gui/internal/proxy"
	"github.com/madic-creates/td-gui/internal/tdbin"
)

// The tests in this file pin the backend lifecycle against a real td serve,
// rather than the fake td internal/backend builds for its own tests. The fake
// encodes what td-gui assumes td does; these check that td still does it.
// td v0.66.0 reworked td serve's shutdown (context cancellation, SSE streams
// closed on shutdown, only its own port file removed), which is exactly the
// behaviour Manager.Stop, Supervise and the reuse probe lean on.
//
// Unix only: Manager.Stop and the foreign instance below are stopped with
// SIGINT, which Windows' os.Process cannot send.

// initProject runs `td init` in a fresh temp directory and returns the td
// binary and the project directory. It skips when td is unavailable.
func initProject(t *testing.T) (td, dir string) {
	t.Helper()
	td, err := tdbin.Locate("")
	if err != nil {
		t.Skipf("td not available: %v", err)
	}
	dir = t.TempDir()
	cmd := exec.Command(td, "init")
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("td init failed: %v\n%s", err, out)
	}
	return td, dir
}

// waitHealthy polls the port file until it names pid, then returns the
// instance's base URL once /health answers 200.
func waitHealthy(t *testing.T, dir string, pid int) string {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if info, err := backend.ReadPortFile(dir); err == nil && info.PID == pid {
			url := fmt.Sprintf("http://127.0.0.1:%d", info.Port)
			if healthStatus(url) == http.StatusOK {
				return url
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("td serve (pid %d) did not become healthy", pid)
	return ""
}

// healthStatus is the status of GET /health, or 0 when nothing answers.
func healthStatus(url string) int {
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(url + "/health")
	if err != nil {
		return 0
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	return resp.StatusCode
}

// startForeign runs a td serve td-gui did not spawn, the way an agent or
// `td monitor` would: no token, its own process. It is interrupted and reaped
// on cleanup.
func startForeign(t *testing.T, td, dir string) (cmd *exec.Cmd, url string, exited <-chan struct{}) {
	t.Helper()
	cmd = exec.Command(td, "serve", "--work-dir", dir, "--addr", "localhost", "--port", "0")
	cmd.Dir = dir
	if err := cmd.Start(); err != nil {
		t.Fatalf("start foreign td serve: %v", err)
	}
	done := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(done)
	}()
	t.Cleanup(func() {
		_ = cmd.Process.Signal(os.Interrupt)
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			_ = cmd.Process.Kill()
			<-done
		}
	})
	return cmd, waitHealthy(t, dir, cmd.Process.Pid), done
}

// TestReuseForeignServeContract pins that td-gui adopts a td serve someone
// else started, proxies to it without a token, and leaves it running when
// td-gui stops.
func TestReuseForeignServeContract(t *testing.T) {
	td, dir := initProject(t)
	_, foreignURL, exited := startForeign(t, td, dir)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	mgr := backend.NewManager(backend.Config{BaseDir: dir, TdPath: td})
	if err := mgr.Start(ctx); err != nil {
		t.Fatalf("start against a foreign td serve: %v", err)
	}
	if mgr.Owned() {
		t.Fatal("Owned() = true, want the foreign instance reused, not a second one spawned")
	}
	if mgr.BaseURL() != foreignURL {
		t.Fatalf("BaseURL() = %q, want the foreign %q", mgr.BaseURL(), foreignURL)
	}
	if mgr.Token() != "" {
		t.Fatal("Token() is set for a foreign instance that requires none")
	}

	api, err := proxy.New(mgr.BaseURL(), mgr.Token())
	if err != nil {
		t.Fatal(err)
	}
	front := httptest.NewServer(api)
	defer front.Close()
	var list struct {
		OK bool `json:"ok"`
	}
	getJSON(t, front.URL+"/v1/issues?limit=1", &list)
	if !list.OK {
		t.Fatal("proxied list through the foreign instance was not ok")
	}

	if err := mgr.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	select {
	case <-exited:
		t.Fatal("Stop terminated a td serve td-gui did not start")
	case <-time.After(500 * time.Millisecond):
	}
	if got := healthStatus(foreignURL); got != http.StatusOK {
		t.Fatalf("foreign /health after Stop = %d, want 200", got)
	}
}

// TestRestartOwnServeContract pins that a td serve td-gui spawned is
// restarted once after it dies unexpectedly, on a new port with a new token,
// and that the new instance accepts that token.
func TestRestartOwnServeContract(t *testing.T) {
	td, dir := initProject(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	mgr := backend.NewManager(backend.Config{BaseDir: dir, TdPath: td})
	if err := mgr.Start(ctx); err != nil {
		t.Fatalf("start: %v", err)
	}
	t.Cleanup(func() { _ = mgr.Stop() })
	if !mgr.Owned() {
		t.Fatal("Owned() = false in a project with no running td serve")
	}
	oldURL, oldToken := mgr.BaseURL(), mgr.Token()
	info, err := backend.ReadPortFile(dir)
	if err != nil {
		t.Fatalf("read port file of our own instance: %v", err)
	}

	type restart struct{ url, token string }
	restarted := make(chan restart, 1)
	mgr.Supervise(ctx, func(url, token string) { restarted <- restart{url, token} })

	// SIGKILL, not SIGINT: an unexpected death, with no chance for td serve
	// to clean up its port file. spawn must not adopt that stale file.
	if err := syscall.Kill(info.PID, syscall.SIGKILL); err != nil {
		t.Fatalf("kill own td serve: %v", err)
	}

	var r restart
	select {
	case r = <-restarted:
	case <-time.After(30 * time.Second):
		t.Fatal("Supervise did not restart the killed td serve")
	}
	if r.token == "" || r.token == oldToken {
		t.Fatalf("restart token = %q, want a fresh one", r.token)
	}
	if r.url == oldURL {
		t.Logf("restart reused port %s; allowed, but unusual", r.url)
	}
	if got := healthStatus(r.url); got != http.StatusOK {
		t.Fatalf("restarted /health = %d, want 200", got)
	}
	if got := healthStatus(oldURL); got == http.StatusOK && r.url != oldURL {
		t.Fatal("the killed instance still answers /health")
	}

	api, err := proxy.New(r.url, r.token)
	if err != nil {
		t.Fatal(err)
	}
	front := httptest.NewServer(api)
	defer front.Close()
	var list struct {
		OK bool `json:"ok"`
	}
	getJSON(t, front.URL+"/v1/issues?limit=1", &list)
	if !list.OK {
		t.Fatal("proxied list through the restarted instance was not ok")
	}
}

// TestStopWithOpenEventStreamContract pins td v0.66.0's shutdown from
// td-gui's side: with the SPA's SSE stream open through the proxy, Stop's
// SIGINT makes td serve close the stream and exit on its own, well inside
// Stop's 5s grace before it falls back to SIGKILL, and td serve removes its
// own port file on the way out.
func TestStopWithOpenEventStreamContract(t *testing.T) {
	td, dir := initProject(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	mgr := backend.NewManager(backend.Config{BaseDir: dir, TdPath: td})
	if err := mgr.Start(ctx); err != nil {
		t.Fatalf("start: %v", err)
	}
	t.Cleanup(func() { _ = mgr.Stop() })
	info, err := backend.ReadPortFile(dir)
	if err != nil {
		t.Fatalf("read port file: %v", err)
	}

	api, err := proxy.New(mgr.BaseURL(), mgr.Token())
	if err != nil {
		t.Fatal(err)
	}
	front := httptest.NewServer(api)
	defer front.Close()

	// The client timeout is the deadline for the stream to end after Stop:
	// a stream td serve leaves open makes the drain below fail with it.
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(front.URL + "/v1/events")
	if err != nil {
		t.Fatalf("open event stream: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("event stream status = %d, want 200", resp.StatusCode)
	}

	began := time.Now()
	if err := mgr.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	// Stop waits up to 5s for the child before killing it, so a graceful
	// exit is one that returns clearly under that.
	if took := time.Since(began); took > 3*time.Second {
		t.Fatalf("Stop took %s with an open event stream; td serve did not exit on SIGINT and was killed", took)
	}

	if _, err := io.Copy(io.Discard, resp.Body); err != nil {
		t.Fatalf("event stream did not end after td serve stopped: %v", err)
	}

	if err := syscall.Kill(info.PID, 0); err == nil {
		t.Fatalf("td serve (pid %d) still alive after Stop", info.PID)
	}
	if _, err := os.Stat(backend.PortFilePath(dir)); !os.IsNotExist(err) {
		t.Fatalf("port file after a graceful stop: stat err = %v, want it removed", err)
	}
}

// TestSecondServeLeavesLiveInstancesPortFileContract pins the other half of
// the v0.66.0 port-file change: a td serve started while another is live for
// the same project refuses to start, says so, and on its way out leaves the
// live instance's port file alone. Manager.spawn relies on that when it races
// another td-gui or a td monitor: the loser exits during startup instead of
// orphaning the winner's port file, and the next Start reuses the winner.
func TestSecondServeLeavesLiveInstancesPortFileContract(t *testing.T) {
	td, dir := initProject(t)
	first, firstURL, _ := startForeign(t, td, dir)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	second := exec.CommandContext(ctx, td, "serve", "--work-dir", dir, "--addr", "localhost", "--port", "0")
	second.Dir = dir
	out, err := second.CombinedOutput()
	if err == nil {
		t.Fatalf("a second td serve for a live project started; output:\n%s", out)
	}
	if ctx.Err() != nil {
		t.Fatal("a second td serve for a live project kept running instead of refusing")
	}
	if !strings.Contains(string(out), "already running") {
		t.Fatalf("second td serve refused without naming the live instance:\n%s", out)
	}

	info, err := backend.ReadPortFile(dir)
	if err != nil {
		t.Fatalf("port file after the refused second instance: %v", err)
	}
	if info.PID != first.Process.Pid {
		t.Fatalf("port file pid = %d, want the live instance's %d", info.PID, first.Process.Pid)
	}
	if got := healthStatus(firstURL); got != http.StatusOK {
		t.Fatalf("live /health = %d, want 200", got)
	}
}
