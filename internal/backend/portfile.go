// Package backend discovers, probes and supervises the td serve process that
// td-gui proxies to.
package backend

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// ErrNoPortFile reports that .todos/serve-port does not exist.
var ErrNoPortFile = errors.New("no serve-port file")

// PortInfo mirrors the JSON td serve writes to .todos/serve-port. The contract
// is fixed in td's docs/td-serve-spec.md.
type PortInfo struct {
	Port       int       `json:"port"`
	PID        int       `json:"pid"`
	StartedAt  time.Time `json:"started_at"`
	InstanceID string    `json:"instance_id"`
}

// PortFilePath returns the path td serve writes its port file to.
func PortFilePath(baseDir string) string {
	return filepath.Join(baseDir, ".todos", "serve-port")
}

// ReadPortFile reads and validates the port file.
func ReadPortFile(baseDir string) (*PortInfo, error) {
	data, err := os.ReadFile(PortFilePath(baseDir))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("%w at %s", ErrNoPortFile, PortFilePath(baseDir))
		}
		return nil, fmt.Errorf("read port file: %w", err)
	}
	var info PortInfo
	if err := json.Unmarshal(data, &info); err != nil {
		return nil, fmt.Errorf("parse port file: %w", err)
	}
	if info.Port <= 0 || info.Port > 65535 {
		return nil, fmt.Errorf("port file has invalid port %d", info.Port)
	}
	return &info, nil
}
