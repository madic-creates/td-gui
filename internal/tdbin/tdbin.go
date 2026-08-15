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
		if _, err := os.Stat(override); err != nil {
			return "", fmt.Errorf("%w: %s: %w", ErrNotFound, override, err)
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
		return "", fmt.Errorf("run %s --version: %w", path, err)
	}
	return ParseVersion(string(out))
}

// ParseVersion extracts a normalized "vX.Y.Z" version from --version output.
func ParseVersion(out string) (string, error) {
	m := versionRe.FindStringSubmatch(out)
	if m == nil {
		return "", fmt.Errorf("no version found in %q", strings.TrimSpace(out))
	}
	return "v" + m[1], nil
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
