//go:build windows

package backend

import (
	"errors"
	"os"
	"syscall"
)

// PIDAlive reports whether a process with the given PID exists.
//
// Unlike Unix, os.FindProcess on Windows opens a real handle via
// OpenProcess, so it already performs the existence check: success alone
// proves the process is running. (The signal(0) idiom used on Unix is not
// portable — Windows' (*os.Process).Signal only implements os.Kill and
// returns EWINDOWS for any other value, including Signal(0), which would
// make this always report false.) Access-denied still means the process
// exists, just owned by another user, mirroring the EPERM case on Unix.
func PIDAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	proc, err := os.FindProcess(pid)
	if err == nil {
		_ = proc.Release()
		return true
	}
	return errors.Is(err, syscall.ERROR_ACCESS_DENIED)
}
