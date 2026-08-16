package backend

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
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
