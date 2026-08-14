package backend

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const defaultStartTimeout = 15 * time.Second

// Config configures a Manager.
type Config struct {
	// BaseDir is the td project directory containing .todos.
	BaseDir string
	// TdPath is the td binary to spawn.
	TdPath string
	// Stderr receives the child process's stderr. Nil discards it.
	Stderr io.Writer
	// StartTimeout bounds how long Start waits for a spawned td serve to
	// become reachable. Zero uses defaultStartTimeout.
	StartTimeout time.Duration
}

// Manager discovers a reusable td serve instance or spawns its own, and owns
// the lifecycle of any instance it spawned.
type Manager struct {
	cfg     Config
	client  *http.Client
	baseURL string
	token   string
	cmd     *exec.Cmd
}

// NewManager returns a Manager for the given configuration.
func NewManager(cfg Config) *Manager {
	if cfg.StartTimeout == 0 {
		cfg.StartTimeout = defaultStartTimeout
	}
	return &Manager{
		cfg:    cfg,
		client: &http.Client{Timeout: 3 * time.Second},
	}
}

// GenerateToken returns a fresh random bearer token.
func GenerateToken() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate token: %w", err)
	}
	return hex.EncodeToString(buf), nil
}

// BaseURL is the origin of the td serve instance, valid after Start.
func (m *Manager) BaseURL() string { return m.baseURL }

// Token is the bearer token to inject, empty when reusing an instance that
// does not require one.
func (m *Manager) Token() string { return m.token }

// Owned reports whether this process spawned the td serve instance.
func (m *Manager) Owned() bool { return m.cmd != nil }

// Start reuses a healthy instance or spawns a new one. It fails if BaseDir is
// not a td project.
func (m *Manager) Start(ctx context.Context) error {
	if _, err := os.Stat(filepath.Join(m.cfg.BaseDir, ".todos")); err != nil {
		return fmt.Errorf("%s is not a td project (no .todos directory) — run `td init` there first", m.cfg.BaseDir)
	}

	if info, err := ReadPortFile(m.cfg.BaseDir); err == nil && PIDAlive(info.PID) {
		url := fmt.Sprintf("http://127.0.0.1:%d", info.Port)
		switch Probe(ctx, m.client, url) {
		case ProbeUsable:
			m.baseURL = url
			m.token = ""
			return nil
		case ProbeUnauthorized:
			return fmt.Errorf("a td serve instance is already running on port %d with a bearer token td-gui does not know; stop it, or start td-gui against a different project", info.Port)
		}
		// ProbeDead: fall through and spawn our own.
	} else if err != nil && !errors.Is(err, ErrNoPortFile) {
		return err
	}

	return m.spawn(ctx)
}

func (m *Manager) spawn(ctx context.Context) error {
	token, err := GenerateToken()
	if err != nil {
		return err
	}

	cmd := exec.Command(m.cfg.TdPath,
		"serve",
		"--work-dir", m.cfg.BaseDir,
		"--addr", "localhost",
		"--port", "0",
		"--token", token,
	)
	cmd.Dir = m.cfg.BaseDir
	cmd.Stderr = m.cfg.Stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start td serve: %w", err)
	}
	m.cmd = cmd

	// td serve writes .todos/serve-port once it is listening. Poll for it,
	// then confirm with a probe rather than trusting the file alone.
	deadline := time.Now().Add(m.cfg.StartTimeout)
	for time.Now().Before(deadline) {
		if info, err := ReadPortFile(m.cfg.BaseDir); err == nil {
			url := fmt.Sprintf("http://127.0.0.1:%d", info.Port)
			req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url+"/health", nil)
			if resp, err := m.client.Do(req); err == nil {
				resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					m.baseURL = url
					m.token = token
					return nil
				}
			}
		}
		select {
		case <-ctx.Done():
			_ = m.Stop()
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}

	_ = m.Stop()
	return fmt.Errorf("td serve did not become reachable within %s", m.cfg.StartTimeout)
}

// Stop terminates the td serve process, but only if this Manager spawned it.
// A reused foreign instance may be serving a td monitor or an agent and is
// left running.
func (m *Manager) Stop() error {
	if m.cmd == nil || m.cmd.Process == nil {
		return nil
	}
	proc := m.cmd.Process
	m.cmd = nil
	if err := proc.Signal(os.Interrupt); err != nil {
		return proc.Kill()
	}
	done := make(chan struct{})
	go func() { _, _ = proc.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-time.After(5 * time.Second):
		return proc.Kill()
	}
}
