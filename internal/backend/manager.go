package backend

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
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
	cfg    Config
	client *http.Client

	// cmd, baseURL and token are written from Supervise's goroutine on a
	// restart and read from callers on the main goroutine (e.g. startup
	// logging), so all of Manager's mutable state is guarded by mu.
	mu        sync.Mutex
	cmd       *exec.Cmd
	baseURL   string
	token     string
	waitCh    chan struct{}
	stopping  bool
	restarted bool
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
func (m *Manager) BaseURL() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.baseURL
}

// Token is the bearer token to inject, empty when reusing an instance that
// does not require one.
func (m *Manager) Token() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.token
}

// Owned reports whether this process spawned the td serve instance.
func (m *Manager) Owned() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.cmd != nil
}

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
			m.mu.Lock()
			m.baseURL, m.token = url, ""
			m.mu.Unlock()
			return nil
		case ProbeUnauthorized:
			return fmt.Errorf("a td serve instance is already running on port %d with a bearer token td-gui does not know; stop it, or start td-gui against a different project", info.Port)
		}
		// ProbeDead: fall through and spawn our own.
	}
	// A missing, corrupt or otherwise unreadable port file all mean the same
	// thing here: there is nothing to reuse. A stale write — e.g. td serve
	// crashing mid-write — must not become a permanent failure: spawning is
	// the only thing that ever overwrites the file, so bailing out here would
	// leave every future Start hitting the same corrupt file forever.

	return m.spawn(ctx)
}

func (m *Manager) spawn(ctx context.Context) error {
	token, err := GenerateToken()
	if err != nil {
		return err
	}

	// --token puts the token in the child's argv, where any local account can
	// read it out of /proc/<pid>/cmdline. That is accepted, not overlooked:
	// td serve offers no other way to receive a token, and CLAUDE.md records
	// the threat model. Switch to --token-file or --token-fd if td grows one.
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
	// Supervise's restart calls this after a crash, racing a concurrent Stop
	// (e.g. the process exiting on SIGTERM at the same moment). Stop reads
	// m.cmd once and returns immediately if it is nil at that instant, so a
	// Stop that lands between the crash and this line would see nothing to
	// kill — and unless spawn also checks m.stopping here, the process
	// started above would register successfully and outlive the program that
	// spawned it. Re-checking under the same lock that guards m.stopping
	// closes that window.
	m.mu.Lock()
	if m.stopping {
		m.mu.Unlock()
		_ = cmd.Process.Kill()
		return fmt.Errorf("stop requested while starting td serve")
	}
	m.cmd = cmd
	m.mu.Unlock()
	// Registered the instant the process exists, not once it is healthy: a
	// Stop landing during the poll below — an ordinary Ctrl+C right after
	// launch — used to find m.waitCh still nil and return as soon as the
	// signal call itself didn't error, without ever confirming the child
	// reacted to it. A child that is slow to exit, or does not react to
	// SIGINT at all, would then outlive td-gui as an orphan. watchChild only
	// ever calls Wait once per cmd, so the later success path below must not
	// call it again.
	m.watchChild(cmd)

	// td serve writes .todos/serve-port once it is listening. Poll for it,
	// then confirm with a probe rather than trusting the file alone. The PID
	// must match the child just started: a foreign process racing to spawn
	// against the same BaseDir (another td-gui, a td monitor) can leave its
	// own port file there, and reading it without checking PID would adopt
	// an instance this Manager never spawned and does not supervise.
	deadline := time.Now().Add(m.cfg.StartTimeout)
	for time.Now().Before(deadline) {
		if info, err := ReadPortFile(m.cfg.BaseDir); err == nil && info.PID == cmd.Process.Pid {
			url := fmt.Sprintf("http://127.0.0.1:%d", info.Port)
			req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url+"/health", nil)
			if resp, err := m.client.Do(req); err == nil {
				resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					m.mu.Lock()
					if m.stopping {
						m.mu.Unlock()
						_ = cmd.Process.Kill()
						return fmt.Errorf("stop requested while starting td serve")
					}
					m.baseURL, m.token = url, token
					m.mu.Unlock()
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
	m.mu.Lock()
	m.stopping = true
	cmd, ch := m.cmd, m.waitCh
	m.cmd = nil
	m.mu.Unlock()

	if cmd == nil || cmd.Process == nil {
		return nil
	}
	if err := cmd.Process.Signal(os.Interrupt); err != nil {
		return cmd.Process.Kill()
	}
	if ch == nil {
		return nil
	}
	select {
	case <-ch:
		return nil
	case <-time.After(5 * time.Second):
		return cmd.Process.Kill()
	}
}

// watchChild reaps the process in one place. exec.Cmd.Wait may only be called
// once, so both Stop and Supervise observe this channel instead of calling it
// themselves.
func (m *Manager) watchChild(cmd *exec.Cmd) {
	ch := make(chan struct{})
	m.mu.Lock()
	m.waitCh = ch
	m.mu.Unlock()
	go func() {
		_ = cmd.Wait()
		close(ch)
	}()
}

// killChildForTest terminates the spawned process without marking the manager
// as stopping, simulating an unexpected backend death.
func (m *Manager) killChildForTest() {
	m.mu.Lock()
	cmd := m.cmd
	m.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}

// Supervise watches a spawned backend and restarts it exactly once if it dies
// unexpectedly, calling onRestart with the new base URL and token.
//
// One attempt, not a retry loop: a backend that dies twice is failing for a
// reason td-gui cannot fix, and an endless respawn would hide that behind a
// UI that looks almost alive. After the single attempt the SSE connection
// stays down and the UI shows its persistent disconnected banner.
func (m *Manager) Supervise(ctx context.Context, onRestart func(baseURL, token string)) {
	if !m.Owned() {
		return // a foreign instance is not ours to supervise
	}
	go func() {
		for {
			m.mu.Lock()
			ch := m.waitCh
			m.mu.Unlock()
			if ch == nil {
				return
			}

			select {
			case <-ctx.Done():
				return
			case <-ch:
			}

			m.mu.Lock()
			stopping, alreadyRestarted := m.stopping, m.restarted
			m.restarted = true
			m.mu.Unlock()

			if stopping || alreadyRestarted {
				return
			}

			if err := m.spawn(ctx); err != nil {
				return
			}
			onRestart(m.BaseURL(), m.Token())
		}
	}()
}
