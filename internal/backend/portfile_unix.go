//go:build !windows

package backend

import (
	"errors"
	"os"
	"syscall"
)

// PIDAlive reports whether a process with the given PID exists. Signal 0
// performs the permission and existence check without delivering a signal.
func PIDAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	err = proc.Signal(syscall.Signal(0))
	// EPERM means the process exists but belongs to another user.
	return err == nil || errors.Is(err, os.ErrPermission)
}
