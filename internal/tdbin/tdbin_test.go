package tdbin

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestParseVersion(t *testing.T) {
	tests := []struct {
		name    string
		out     string
		want    string
		wantErr bool
	}{
		{"standard", "td version v0.57.0\n", "v0.57.0", false},
		{"no v prefix", "td version 0.57.0\n", "v0.57.0", false},
		{"with build suffix", "td version v0.57.0-dirty\n", "v0.57.0-dirty", false},
		{"unparseable", "some other tool\n", "", true},
		{"empty", "", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseVersion(tt.out)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("ParseVersion(%q) = %q, want error", tt.out, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseVersion(%q) unexpected error: %v", tt.out, err)
			}
			if got != tt.want {
				t.Errorf("ParseVersion(%q) = %q, want %q", tt.out, got, tt.want)
			}
		})
	}
}

func TestAtLeast(t *testing.T) {
	tests := []struct {
		version, min string
		want         bool
	}{
		{"v0.57.0", "v0.57.0", true},
		{"v0.57.1", "v0.57.0", true},
		{"v0.58.0", "v0.57.0", true},
		{"v1.0.0", "v0.57.0", true},
		{"v0.56.9", "v0.57.0", false},
		{"v0.9.0", "v0.57.0", false},
		{"v0.57.0-dirty", "v0.57.0", true},
	}
	for _, tt := range tests {
		got, err := AtLeast(tt.version, tt.min)
		if err != nil {
			t.Fatalf("AtLeast(%q, %q) unexpected error: %v", tt.version, tt.min, err)
		}
		if got != tt.want {
			t.Errorf("AtLeast(%q, %q) = %v, want %v", tt.version, tt.min, got, tt.want)
		}
	}
}

func TestAtLeastRejectsGarbage(t *testing.T) {
	if _, err := AtLeast("not-a-version", "v0.57.0"); err == nil {
		t.Error("AtLeast with unparseable version: want error, got nil")
	}
}

func TestLocateHonorsOverride(t *testing.T) {
	dir := t.TempDir()
	fake := filepath.Join(dir, "td")
	if err := os.WriteFile(fake, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	got, err := Locate(fake)
	if err != nil {
		t.Fatalf("Locate(%q) unexpected error: %v", fake, err)
	}
	if got != fake {
		t.Errorf("Locate(%q) = %q, want %q", fake, got, fake)
	}
}

func TestLocateMissingOverride(t *testing.T) {
	_, err := Locate(filepath.Join(t.TempDir(), "nope"))
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("Locate(missing) error = %v, want ErrNotFound", err)
	}
}

// TestLocateFindsBinaryOnPATH covers the no-override path: the common case,
// since most invocations never pass --td.
func TestLocateFindsBinaryOnPATH(t *testing.T) {
	dir := t.TempDir()
	fake := filepath.Join(dir, "td")
	if err := os.WriteFile(fake, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)

	got, err := Locate("")
	if err != nil {
		t.Fatalf(`Locate("") unexpected error: %v`, err)
	}
	if got != fake {
		t.Errorf(`Locate("") = %q, want %q`, got, fake)
	}
}

func TestLocateMissingFromPATH(t *testing.T) {
	t.Setenv("PATH", t.TempDir())

	_, err := Locate("")
	if !errors.Is(err, ErrNotFound) {
		t.Errorf(`Locate("") error = %v, want ErrNotFound`, err)
	}
}

func TestVersionContextTimesOutOnHungBinary(t *testing.T) {
	dir := t.TempDir()
	hung := filepath.Join(dir, "td")
	// exec, not a bare sleep: without it sleep runs as a child of the shell,
	// and killing the shell on timeout leaves sleep holding the output pipe
	// open, so Output() would still block for the full sleep.
	if err := os.WriteFile(hung, []byte("#!/bin/sh\nexec sleep 10\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	start := time.Now()
	_, err := VersionContext(context.Background(), hung, 100*time.Millisecond)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("VersionContext with a hung binary: want error, got nil")
	}
	if elapsed > 5*time.Second {
		t.Errorf("VersionContext did not respect its timeout: took %s", elapsed)
	}
}
