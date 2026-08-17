// Package tdbin locates the td binary and checks its version.
package tdbin

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ErrNotFound reports that no usable td binary could be found.
var ErrNotFound = errors.New("td binary not found")

// versionTimeout bounds how long `td --version` may run. td-gui calls this
// synchronously during startup, before anything else has happened; a td
// binary that hangs (a wrapper script waiting on stdin, a broken shim) must
// not hang td-gui with it.
const versionTimeout = 5 * time.Second

// versionRe matches the version token in `td --version` output, e.g.
// "td version v0.57.0". The v prefix is optional; a build suffix is kept.
var versionRe = regexp.MustCompile(`\bv?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)`)

// Locate returns an absolute path to the td binary. A non-empty override is
// used verbatim and must exist; otherwise td is looked up in PATH.
func Locate(override string) (string, error) {
	if override != "" {
		info, err := os.Stat(override)
		if err != nil {
			return "", fmt.Errorf("%w: %s: %w", ErrNotFound, override, err)
		}
		// os.Stat succeeds on a directory too. Left unchecked, a --td that
		// points at one is accepted here and only fails later inside
		// exec.CommandContext with a generic "is a directory" exec error
		// that gives no hint the path itself, not td, is the problem.
		if info.IsDir() {
			return "", fmt.Errorf("%w: %s: is a directory", ErrNotFound, override)
		}
		return override, nil
	}
	path, err := exec.LookPath("td")
	if err != nil {
		return "", fmt.Errorf("%w in PATH", ErrNotFound)
	}
	return path, nil
}

// Version runs `td --version` and returns the parsed version string. The run
// is bounded by versionTimeout.
func Version(path string) (string, error) {
	return VersionContext(context.Background(), path, versionTimeout)
}

// VersionContext runs `td --version` with the given timeout, returning the
// parsed version string. Exposed separately from Version so tests can use a
// short timeout without waiting out the real one.
func VersionContext(ctx context.Context, path string, timeout time.Duration) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	out, err := exec.CommandContext(ctx, path, "--version").Output()
	if err != nil {
		if ctx.Err() != nil {
			return "", fmt.Errorf("run %s --version: timed out after %s", path, timeout)
		}
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			if stderr := strings.TrimSpace(string(exitErr.Stderr)); stderr != "" {
				return "", fmt.Errorf("run %s --version: %w: %s", path, err, stderr)
			}
		}
		return "", fmt.Errorf("run %s --version: %w", path, err)
	}
	return ParseVersion(string(out))
}

// ParseVersion extracts a normalized "vX.Y.Z" version from --version output.
//
// A shim or version manager wrapping td (asdf, mise, a corporate proxy
// banner) can print its own version-shaped line before delegating to the
// real binary, e.g. "Using node v18.2.0 wrapper\ntd version v0.57.3". A blind
// search over the whole output would silently pick up the wrapper's number
// instead of td's, so the line naming "version" is preferred when present;
// only output with no such line falls back to the old whole-text search.
func ParseVersion(out string) (string, error) {
	if m := versionRe.FindStringSubmatch(versionLine(out)); m != nil {
		return "v" + m[1], nil
	}
	m := versionRe.FindStringSubmatch(out)
	if m == nil {
		return "", fmt.Errorf("no version found in %q", strings.TrimSpace(out))
	}
	return "v" + m[1], nil
}

// versionLine returns the first line of out that mentions "version", or ""
// if none does.
func versionLine(out string) string {
	for _, line := range strings.Split(out, "\n") {
		if strings.Contains(strings.ToLower(line), "version") {
			return line
		}
	}
	return ""
}

// AtLeast reports whether version is greater than or equal to min. Build
// suffixes are ignored: v0.57.0-dirty counts as v0.57.0.
func AtLeast(version, min string) (bool, error) {
	a, err := parts(version)
	if err != nil {
		return false, err
	}
	b, err := parts(min)
	if err != nil {
		return false, err
	}
	for i := range 3 {
		if a[i] != b[i] {
			return a[i] > b[i], nil
		}
	}
	return true, nil
}

func parts(v string) ([3]int, error) {
	var out [3]int
	m := versionRe.FindStringSubmatch(v)
	if m == nil {
		return out, fmt.Errorf("unparseable version %q", v)
	}
	core, _, _ := strings.Cut(m[1], "-")
	core, _, _ = strings.Cut(core, "+")
	for i, seg := range strings.SplitN(core, ".", 3) {
		n, err := strconv.Atoi(seg)
		if err != nil {
			return out, fmt.Errorf("unparseable version %q: %w", v, err)
		}
		out[i] = n
	}
	return out, nil
}
