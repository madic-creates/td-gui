package backend

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func TestGenerateTokenIsRandomAndLong(t *testing.T) {
	a, err := GenerateToken()
	if err != nil {
		t.Fatal(err)
	}
	b, err := GenerateToken()
	if err != nil {
		t.Fatal(err)
	}
	if len(a) != 32 {
		t.Errorf("token length = %d, want 32", len(a))
	}
	if a == b {
		t.Error("two generated tokens are identical")
	}
}

// startFakeServe stands in for a running td serve: it answers the probe and
// writes a port file pointing at itself.
func startFakeServe(t *testing.T, baseDir string, requireToken bool) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if requireToken && r.URL.Path != "/health" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Write([]byte(`{"ok":true,"data":{}}`))
	}))
	t.Cleanup(srv.Close)

	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(baseDir, ".todos"), 0o755); err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf(`{"port":%d,"pid":%d,"started_at":%q,"instance_id":"srv_fake"}`,
		port, os.Getpid(), time.Now().Format(time.RFC3339))
	if err := os.WriteFile(PortFilePath(baseDir), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return srv
}

func TestStartReusesHealthyInstance(t *testing.T) {
	base := t.TempDir()
	srv := startFakeServe(t, base, false)

	m := NewManager(Config{BaseDir: base, TdPath: "/nonexistent/td"})
	if err := m.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer m.Stop()

	if m.BaseURL() != srv.URL {
		t.Errorf("BaseURL = %q, want %q", m.BaseURL(), srv.URL)
	}
	if m.Owned() {
		t.Error("Owned = true after reusing a foreign instance, want false")
	}
	if m.Token() != "" {
		t.Error("Token is set after reusing an unauthenticated instance, want empty")
	}
}

func TestStopLeavesForeignInstanceAlone(t *testing.T) {
	base := t.TempDir()
	srv := startFakeServe(t, base, false)

	m := NewManager(Config{BaseDir: base, TdPath: "/nonexistent/td"})
	if err := m.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if err := m.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	// The foreign server must still answer.
	resp, err := srv.Client().Get(srv.URL + "/health")
	if err != nil {
		t.Fatalf("foreign instance was killed by Stop: %v", err)
	}
	resp.Body.Close()
}

func TestStartRejectsTokenProtectedForeignInstance(t *testing.T) {
	base := t.TempDir()
	startFakeServe(t, base, true)

	// TdPath does not exist, so spawning must fail. The point is that Start
	// does NOT silently reuse the 401 instance.
	m := NewManager(Config{BaseDir: base, TdPath: "/nonexistent/td"})
	err := m.Start(context.Background())
	if err == nil {
		t.Fatal("Start succeeded against a token-protected foreign instance, want error")
	}
}

// startUnhealthyFakeServe simulates a td serve instance that is up (answers
// /health) but errors on every authenticated read — a live process in a
// broken state, distinct from one that is not there at all.
func startUnhealthyFakeServe(t *testing.T, baseDir string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.Write([]byte(`{"ok":true,"data":{"status":"ok"}}`))
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)

	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(baseDir, ".todos"), 0o755); err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf(`{"port":%d,"pid":%d,"started_at":%q,"instance_id":"srv_fake"}`,
		port, os.Getpid(), time.Now().Format(time.RFC3339))
	if err := os.WriteFile(PortFilePath(baseDir), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return srv
}

// TestStartRejectsUnusableForeignInstance guards against a live-but-broken
// instance (answers /health, errors on an authenticated read) being treated
// like a dead one. Before ProbeUnusable existed, Probe's default case folded
// this into ProbeDead, and Start would fall through to spawn a second td
// serve against the same .todos directory — two processes writing to the
// same database. TdPath is a *working* stub, not a missing binary: if Start
// fell through to spawn here it would succeed, so failure is the only
// signal that Start refused to spawn a second instance rather than merely
// failing to spawn one.
func TestStartRejectsUnusableForeignInstance(t *testing.T) {
	base := t.TempDir()
	startUnhealthyFakeServe(t, base)

	m := NewManager(Config{BaseDir: base, TdPath: fakeTd(t), StartTimeout: 10 * time.Second})
	err := m.Start(context.Background())
	defer m.Stop()
	if err == nil {
		t.Fatal("Start succeeded against an unusable foreign instance (it spawned a second process), want error")
	}
	if m.Owned() {
		t.Error("Start spawned an owned process against an unusable foreign instance, want none")
	}
}

func TestSpawnIgnoresStalePortFileFromAnotherInstance(t *testing.T) {
	base := t.TempDir()
	// A foreign, still-live instance's port file already sits at BaseDir,
	// simulating another td-gui or td monitor racing to spawn against the
	// same project. spawn must not adopt it just because it answers /health;
	// the PID must belong to the child spawn just started.
	foreign := startFakeServe(t, base, false)

	m := NewManager(Config{BaseDir: base, TdPath: fakeTd(t), StartTimeout: 10 * time.Second})
	if err := m.spawn(context.Background()); err != nil {
		t.Fatalf("spawn: %v", err)
	}
	defer m.Stop()

	if m.BaseURL() == foreign.URL {
		t.Errorf("spawn adopted the foreign instance's port file (%s), want its own child's", foreign.URL)
	}
}

// TestSpawnAbortsIfStoppedConcurrently guards against a race where Supervise
// calls spawn to restart a crashed backend at the same moment Stop runs (e.g.
// td-gui exiting on SIGTERM just as the child crashes). Stop reads m.cmd once
// and returns immediately if it observes nil, so without this check spawn
// would register the new process and report success for something nobody
// remains to kill — orphaning it after td-gui has already exited.
func TestSpawnAbortsIfStoppedConcurrently(t *testing.T) {
	base := t.TempDir()
	if err := os.MkdirAll(filepath.Join(base, ".todos"), 0o755); err != nil {
		t.Fatal(err)
	}

	m := NewManager(Config{BaseDir: base, TdPath: fakeTd(t), StartTimeout: 10 * time.Second})

	// Simulate Stop() having already run and set the flag by the time spawn
	// reaches its post-Start check.
	m.mu.Lock()
	m.stopping = true
	m.mu.Unlock()

	if err := m.spawn(context.Background()); err == nil {
		t.Fatal("spawn succeeded despite a concurrent Stop, want an error and no registered process")
	}

	m.mu.Lock()
	cmd := m.cmd
	m.mu.Unlock()
	if cmd != nil {
		t.Error("spawn registered a process after Stop had already run; it would outlive td-gui as an orphan")
	}
}

// fakeTdIgnoringSIGINT builds a stub "td" that ignores SIGINT and never
// becomes healthy, so a Stop landing while it is still starting can only be
// confirmed by actually watching it exit — a Signal call that merely didn't
// error is not evidence the child reacted to it.
func fakeTdIgnoringSIGINT(t *testing.T) string {
	t.Helper()
	src := `package main

import (
	"os/signal"
	"syscall"
	"time"
)

func main() {
	signal.Ignore(syscall.SIGINT)
	time.Sleep(time.Hour)
}
`
	dir := t.TempDir()
	srcPath := dir + "/main.go"
	if err := os.WriteFile(srcPath, []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	bin := dir + "/fake-td-stubborn"
	cmd := exec.Command("go", "build", "-o", bin, srcPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("cannot build fake td: %v\n%s", err, out)
	}
	return bin
}

// TestStopKillsChildStartedButNotYetHealthy pins that a Stop landing while
// td serve is still starting — the ordinary shape of a Ctrl+C right after
// launch — actually terminates the child instead of just sending a signal
// and trusting it worked. watchChild used to run only after the health
// check passed, so Stop found m.waitCh nil during the whole startup window
// and returned the instant Signal() itself didn't error, regardless of
// whether the child reacted; a slow or signal-ignoring child would then
// outlive td-gui as an orphan.
func TestStopKillsChildStartedButNotYetHealthy(t *testing.T) {
	base := t.TempDir()
	if err := os.MkdirAll(filepath.Join(base, ".todos"), 0o755); err != nil {
		t.Fatal(err)
	}

	m := NewManager(Config{BaseDir: base, TdPath: fakeTdIgnoringSIGINT(t), StartTimeout: 10 * time.Second})

	spawnErr := make(chan error, 1)
	go func() { spawnErr <- m.spawn(context.Background()) }()

	// Wait for the process to be registered. It never becomes healthy (it
	// never writes a port file), so this can only observe the
	// pre-health-check window this test targets.
	var pid int
	deadline := time.Now().Add(2 * time.Second)
	for pid == 0 {
		m.mu.Lock()
		if m.cmd != nil && m.cmd.Process != nil {
			pid = m.cmd.Process.Pid
		}
		m.mu.Unlock()
		if time.Now().After(deadline) {
			t.Fatal("spawn never registered a process")
		}
		time.Sleep(10 * time.Millisecond)
	}

	stopped := make(chan struct{})
	go func() {
		_ = m.Stop()
		close(stopped)
	}()

	select {
	case <-stopped:
	case <-time.After(8 * time.Second):
		t.Fatal("Stop did not return; a signal-ignoring child during startup can hang it forever")
	}

	// A Kill just issued leaves the process a zombie for a moment before it
	// is reaped, and PIDAlive (signal 0) still sees a zombie as alive on
	// Unix — so give reaping a brief window rather than asserting instantly.
	reaped := false
	for deadline := time.Now().Add(2 * time.Second); time.Now().Before(deadline); {
		if !PIDAlive(pid) {
			reaped = true
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !reaped {
		t.Error("child is still alive after Stop returned; it ignores SIGINT and nothing fell back to killing it")
	}

	select {
	case <-spawnErr:
	case <-time.After(5 * time.Second):
		t.Error("spawn's poll loop never returned after its child was killed")
	}
}

func TestStartFailsWithoutTodosDir(t *testing.T) {
	m := NewManager(Config{BaseDir: t.TempDir(), TdPath: "/nonexistent/td"})
	if err := m.Start(context.Background()); err == nil {
		t.Fatal("Start succeeded in a non-td directory, want error")
	}
}

func TestStartRecoversFromCorruptPortFile(t *testing.T) {
	base := t.TempDir()
	if err := os.MkdirAll(filepath.Join(base, ".todos"), 0o755); err != nil {
		t.Fatal(err)
	}
	// A stale write from a td serve that crashed mid-write is not always
	// valid JSON. Start must spawn a fresh instance rather than treating this
	// as a permanent failure — nothing else would ever overwrite the file.
	if err := os.WriteFile(PortFilePath(base), []byte("{not valid json"), 0o644); err != nil {
		t.Fatal(err)
	}

	m := NewManager(Config{BaseDir: base, TdPath: fakeTd(t), StartTimeout: 10 * time.Second})
	if err := m.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer m.Stop()

	if !m.Owned() {
		t.Error("Owned = false after recovering from a corrupt port file, want true (Start should have spawned)")
	}
}
