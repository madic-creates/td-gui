package backend

import (
	"context"
	"os"
	"os/exec"
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
