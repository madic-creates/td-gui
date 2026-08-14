package backend

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func writePortFile(t *testing.T, baseDir, content string) {
	t.Helper()
	dir := filepath.Join(baseDir, ".todos")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "serve-port"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestReadPortFile(t *testing.T) {
	base := t.TempDir()
	writePortFile(t, base, `{
	  "port": 45999,
	  "pid": 36791,
	  "started_at": "2026-08-14T15:01:46.334487772+02:00",
	  "instance_id": "srv_6ca58e"
	}`)

	info, err := ReadPortFile(base)
	if err != nil {
		t.Fatalf("ReadPortFile: %v", err)
	}
	if info.Port != 45999 {
		t.Errorf("Port = %d, want 45999", info.Port)
	}
	if info.PID != 36791 {
		t.Errorf("PID = %d, want 36791", info.PID)
	}
	if info.InstanceID != "srv_6ca58e" {
		t.Errorf("InstanceID = %q, want srv_6ca58e", info.InstanceID)
	}
	if info.StartedAt.IsZero() {
		t.Error("StartedAt is zero, want the parsed timestamp")
	}
}

func TestReadPortFileMissing(t *testing.T) {
	_, err := ReadPortFile(t.TempDir())
	if !errors.Is(err, ErrNoPortFile) {
		t.Errorf("error = %v, want ErrNoPortFile", err)
	}
}

func TestReadPortFileMalformed(t *testing.T) {
	base := t.TempDir()
	writePortFile(t, base, `not json at all`)
	if _, err := ReadPortFile(base); err == nil {
		t.Error("want error for malformed JSON, got nil")
	}
}

func TestReadPortFileRejectsZeroPort(t *testing.T) {
	base := t.TempDir()
	writePortFile(t, base, `{"port":0,"pid":1,"instance_id":"srv_x"}`)
	if _, err := ReadPortFile(base); err == nil {
		t.Error("want error for zero port, got nil")
	}
}

func TestPIDAliveSelf(t *testing.T) {
	if !PIDAlive(os.Getpid()) {
		t.Error("PIDAlive(self) = false, want true")
	}
}

func TestPIDAliveImplausible(t *testing.T) {
	// PID 0 is never a real user process to signal.
	if PIDAlive(0) {
		t.Error("PIDAlive(0) = true, want false")
	}
}
