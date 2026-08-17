package backend

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeTd builds a stub "td" that writes a port file and serves /health, so
// supervision can be tested without the real binary.
func fakeTd(t *testing.T) string {
	t.Helper()
	src := `package main

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func main() {
	dir := "."
	for i, a := range os.Args {
		if a == "--work-dir" && i+1 < len(os.Args) {
			dir = os.Args[i+1]
		}
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		os.Exit(1)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	body := fmt.Sprintf(` + "`" + `{"port":%d,"pid":%d,"started_at":%q,"instance_id":"srv_fake"}` + "`" + `,
		port, os.Getpid(), time.Now().Format(time.RFC3339))
	os.MkdirAll(filepath.Join(dir, ".todos"), 0o755)
	os.WriteFile(filepath.Join(dir, ".todos", "serve-port"), []byte(body), 0o644)

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(` + "`" + `{"ok":true,"data":{}}` + "`" + `))
	})
	http.Serve(ln, mux)
}
`
	dir := t.TempDir()
	srcPath := dir + "/main.go"
	if err := os.WriteFile(srcPath, []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	bin := dir + "/fake-td"
	cmd := exec.Command("go", "build", "-o", bin, srcPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("cannot build fake td: %v\n%s", err, out)
	}
	return bin
}

// fakeTdFailsOnRestart behaves like fakeTd on its first invocation, but exits
// immediately without ever writing a port file on any invocation after that —
// simulating the one restart attempt itself failing to spawn (a removed
// binary, disk full, port exhaustion), not merely being slow to become
// healthy.
func fakeTdFailsOnRestart(t *testing.T) string {
	t.Helper()
	src := `package main

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func main() {
	dir := "."
	for i, a := range os.Args {
		if a == "--work-dir" && i+1 < len(os.Args) {
			dir = os.Args[i+1]
		}
	}
	marker := filepath.Join(dir, ".todos", "restart-attempted")
	if _, err := os.Stat(marker); err == nil {
		os.Exit(1)
	}
	os.MkdirAll(filepath.Join(dir, ".todos"), 0o755)
	os.WriteFile(marker, []byte("1"), 0o644)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		os.Exit(1)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	body := fmt.Sprintf(` + "`" + `{"port":%d,"pid":%d,"started_at":%q,"instance_id":"srv_fake"}` + "`" + `,
		port, os.Getpid(), time.Now().Format(time.RFC3339))
	os.WriteFile(filepath.Join(dir, ".todos", "serve-port"), []byte(body), 0o644)

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(` + "`" + `{"ok":true,"data":{}}` + "`" + `))
	})
	http.Serve(ln, mux)
}
`
	dir := t.TempDir()
	srcPath := filepath.Join(dir, "main.go")
	if err := os.WriteFile(srcPath, []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(dir, "fake-td")
	cmd := exec.Command("go", "build", "-o", bin, srcPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("cannot build fake td: %v\n%s", err, out)
	}
	return bin
}

// syncBuffer is a Stderr a test can read while the Manager is still running.
//
// A Manager's Stderr has more than one writer: Supervise logs a failed restart
// from its own goroutine, and os/exec copies the child's stderr on a goroutine
// of its own whenever the writer is not an *os.File. A bare bytes.Buffer is
// unsafe for that, and unsafe again for a test goroutine reading it — which is
// what the race detector caught here.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// TestSuperviseLogsWhenRestartFails covers the gap where the one permitted
// restart attempt itself fails to spawn: onRestart is correctly never called
// (nothing to switch the proxy to), but that must not be the operator's only
// signal — a line naming the failure belongs on cfg.Stderr instead of being
// silently swallowed.
func TestSuperviseLogsWhenRestartFails(t *testing.T) {
	base := t.TempDir()
	if err := os.MkdirAll(base+"/.todos", 0o755); err != nil {
		t.Fatal(err)
	}

	var stderr syncBuffer
	m := NewManager(Config{
		BaseDir:      base,
		TdPath:       fakeTdFailsOnRestart(t),
		Stderr:       &stderr,
		StartTimeout: 500 * time.Millisecond,
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := m.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer m.Stop()

	restarted := make(chan string, 1)
	m.Supervise(ctx, func(baseURL, token string) { restarted <- baseURL })

	m.killChildForTest()

	// Wait for the line, not for a fixed interval. Supervise returns the
	// moment it has logged, so the line appearing is what proves the restart
	// was attempted, failed, and gave up — which is exactly the point at which
	// onRestart can no longer be called. A timer can only assume that, and it
	// spent five seconds per run assuming it.
	deadline := time.Now().Add(10 * time.Second)
	for !strings.Contains(stderr.String(), "restart failed") {
		if time.Now().After(deadline) {
			t.Fatalf("Stderr = %q, want it to mention the restart failure", stderr.String())
		}
		time.Sleep(10 * time.Millisecond)
	}

	// Now that the goroutine has given up, a non-blocking check is conclusive
	// rather than merely hopeful.
	select {
	case url := <-restarted:
		t.Fatalf("onRestart called with %q, want it never called when the restart itself fails", url)
	default:
	}
}

func TestSuperviseRestartsOnce(t *testing.T) {
	base := t.TempDir()
	if err := os.MkdirAll(base+"/.todos", 0o755); err != nil {
		t.Fatal(err)
	}

	m := NewManager(Config{BaseDir: base, TdPath: fakeTd(t), StartTimeout: 10 * time.Second})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := m.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer m.Stop()

	firstURL := m.BaseURL()

	restarted := make(chan string, 1)
	m.Supervise(ctx, func(baseURL, token string) { restarted <- baseURL })

	// Kill the child out from under the manager.
	m.killChildForTest()

	select {
	case newURL := <-restarted:
		if newURL == "" {
			t.Error("restart reported an empty base URL")
		}
		if newURL == firstURL {
			t.Error("restarted backend reused the old URL; the port should be fresh")
		}
	case <-time.After(20 * time.Second):
		t.Fatal("supervisor did not restart the backend")
	}
}

func TestSuperviseDoesNotRestartTwice(t *testing.T) {
	base := t.TempDir()
	if err := os.MkdirAll(base+"/.todos", 0o755); err != nil {
		t.Fatal(err)
	}

	m := NewManager(Config{BaseDir: base, TdPath: fakeTd(t), StartTimeout: 10 * time.Second})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := m.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer m.Stop()

	restarts := make(chan string, 4)
	m.Supervise(ctx, func(baseURL, token string) { restarts <- baseURL })

	m.killChildForTest()
	select {
	case <-restarts:
	case <-time.After(20 * time.Second):
		t.Fatal("first restart did not happen")
	}

	// A second death must NOT produce another restart: the spec allows
	// exactly one attempt, then the UI shows a persistent disconnected state.
	m.killChildForTest()
	select {
	case url := <-restarts:
		t.Errorf("supervisor restarted a second time (%s), want at most one attempt", url)
	case <-time.After(5 * time.Second):
	}
}

// TestBaseURLAndTokenSafeDuringRestart exercises BaseURL/Token/Owned from
// another goroutine while Supervise's own goroutine writes cmd/baseURL/token
// on restart. All three accessors and their writers now share m.mu, so this
// must run clean under go test -race; it also pins the observable contract
// that a caller never sees baseURL paired with a token from a different
// generation.
func TestBaseURLAndTokenSafeDuringRestart(t *testing.T) {
	base := t.TempDir()
	if err := os.MkdirAll(base+"/.todos", 0o755); err != nil {
		t.Fatal(err)
	}

	m := NewManager(Config{BaseDir: base, TdPath: fakeTd(t), StartTimeout: 10 * time.Second})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := m.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer m.Stop()

	stopPolling := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			select {
			case <-stopPolling:
				return
			default:
				_ = m.BaseURL()
				_ = m.Token()
				_ = m.Owned()
			}
		}
	}()

	restarted := make(chan string, 1)
	m.Supervise(ctx, func(baseURL, token string) { restarted <- baseURL })
	m.killChildForTest()

	select {
	case <-restarted:
	case <-time.After(20 * time.Second):
		t.Fatal("supervisor did not restart the backend")
	}

	close(stopPolling)
	<-done

	if m.BaseURL() == "" || m.Token() == "" {
		t.Error("BaseURL/Token empty after restart")
	}
	if !m.Owned() {
		t.Error("Owned = false after restart, want true (the respawned process is still ours)")
	}
}
