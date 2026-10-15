//go:build !windows

package contract

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/madic-creates/td-gui/internal/tdbin"
)

// td-gui follows td's answer to "which project is this?" rather than its own
// working directory, so the redirections td resolves (.td-root, git
// worktrees) are td's to keep working. These pin that td still resolves them
// through `td info --json -w`.

func sameDir(t *testing.T, got, want string) {
	t.Helper()
	g, err := filepath.EvalSymlinks(got)
	if err != nil {
		t.Fatalf("resolve %s: %v", got, err)
	}
	w, err := filepath.EvalSymlinks(want)
	if err != nil {
		t.Fatalf("resolve %s: %v", want, err)
	}
	if g != w {
		t.Errorf("BaseDir = %q, want %q", got, want)
	}
}

func TestBaseDirContract(t *testing.T) {
	td, dir := initProject(t)

	t.Run("project itself", func(t *testing.T) {
		got, err := tdbin.BaseDir(td, dir)
		if err != nil {
			t.Fatalf("BaseDir: %v", err)
		}
		sameDir(t, got, dir)
	})

	t.Run("td-root", func(t *testing.T) {
		elsewhere := t.TempDir()
		if err := os.WriteFile(filepath.Join(elsewhere, ".td-root"), []byte(dir+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		got, err := tdbin.BaseDir(td, elsewhere)
		if err != nil {
			t.Fatalf("BaseDir: %v", err)
		}
		sameDir(t, got, dir)
	})

	t.Run("no project", func(t *testing.T) {
		if got, err := tdbin.BaseDir(td, t.TempDir()); err == nil {
			t.Errorf("BaseDir outside any project = %q, want error", got)
		}
	})
}

func TestBaseDirWorktreeContract(t *testing.T) {
	td, dir := initProject(t)
	git, err := exec.LookPath("git")
	if err != nil {
		t.Skipf("git not available: %v", err)
	}
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command(git, args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@example.com",
			"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@example.com")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	worktree := filepath.Join(t.TempDir(), "wt")
	run("init", "-q")
	run("-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "init")
	run("worktree", "add", "-q", worktree)

	got, err := tdbin.BaseDir(td, worktree)
	if err != nil {
		t.Fatalf("BaseDir: %v", err)
	}
	sameDir(t, got, dir)
}
