package backend

import (
	"context"
	"net/http"
)

// ProbeResult classifies a td serve instance found via the port file.
type ProbeResult int

const (
	// ProbeUsable means the instance answers authenticated reads without a
	// token, so td-gui can proxy to it as-is.
	ProbeUsable ProbeResult = iota
	// ProbeUnauthorized means the instance is alive but was started with a
	// token td-gui does not know. It cannot be reused.
	ProbeUnauthorized
	// ProbeDead means the instance does not answer at all.
	ProbeDead
)

func (r ProbeResult) String() string {
	switch r {
	case ProbeUsable:
		return "usable"
	case ProbeUnauthorized:
		return "unauthorized"
	default:
		return "dead"
	}
}

// Probe checks whether the td serve instance at baseURL can be reused.
//
// It performs two requests because td exempts /health from its auth
// middleware: a token-protected instance looks healthy but rejects every
// proxied call. The second request hits an authenticated read to detect that.
func Probe(ctx context.Context, client *http.Client, baseURL string) ProbeResult {
	if status, ok := get(ctx, client, baseURL+"/health"); !ok || status != http.StatusOK {
		return ProbeDead
	}
	status, ok := get(ctx, client, baseURL+"/v1/labels")
	switch {
	case !ok:
		return ProbeDead
	case status == http.StatusUnauthorized:
		return ProbeUnauthorized
	case status == http.StatusOK:
		return ProbeUsable
	default:
		return ProbeDead
	}
}

func get(ctx context.Context, client *http.Client, url string) (int, bool) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, false
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, false
	}
	defer resp.Body.Close()
	return resp.StatusCode, true
}
