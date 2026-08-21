// Package tdstatus sets an issue's status through the td CLI.
//
// td serve v0.57.0 has no route for it: POST /v1/issues/{id}/unstart is a 404,
// and PATCH /v1/issues/{id} answers ok while silently ignoring a status field.
// Three moves therefore have no API at all — in_progress -> open,
// in_review -> in_progress and blocked -> in_progress — and every other status
// change goes through td's own transition endpoints, as it did before this
// package existed.
//
// This is the second route to leave the proxy and the only one that writes.
// The architecture invariant it bends is the one internal/tdquery bends, with
// the same limits: no database is opened, no `td init` is run, and td's own
// binary owns the rules and phrases the refusal. It stays restricted to the
// jumps td serve cannot express, and it disappears the day td serve grows a
// status or unstart endpoint (see td-2b4bc9). Nothing else should follow it
// out of the proxy.
package tdstatus

import (
	"context"
	"encoding/json"
	"net/http"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// runTimeout bounds one status change, in the spirit of tdquery's: a td that
// hangs on a locked database must not hold the request open, because nothing
// downstream would ever release it — the server's WriteTimeout is 0 so SSE
// can stream.
const runTimeout = 10 * time.Second

// statuses is td's set. The value reaches td's argv as the argument of
// --status, so it is checked here rather than left to td: this is the one
// place in td-gui that puts a request's content into a subprocess, and an
// unchecked string there is a flag waiting to happen. It is not a prediction
// of td's answer — which jumps are legal stays td's to decide, and its
// refusal is what the user reads.
var statuses = map[string]bool{
	"open": true, "in_progress": true, "in_review": true,
	"blocked": true, "closed": true,
}

// ansiRe matches the SGR sequences td colours its stderr with.
var ansiRe = regexp.MustCompile(`\x1b\[[0-9;]*m`)

// prefixRe matches the label td puts in front of a refusal — Warning: for a
// jump it will not make, ERROR: for an issue it cannot find. Both are CLI
// display artifacts; the sentence after them is the answer.
var prefixRe = regexp.MustCompile(`(?i)^(?:ERROR|WARNING):\s*`)

type handler struct {
	td      string
	baseDir string
	timeout time.Duration
}

// Handler answers POST /gui/status with the status change applied.
//
// Deliberately not under /v1/: that prefix is td's API, proxied wholesale, and
// this is not td. The /gui/ prefix marks the exact code to delete once td
// serve sets a status itself.
func Handler(td, baseDir string) http.Handler {
	return &handler{td: td, baseDir: baseDir, timeout: runTimeout}
}

// change is what the browser asks for.
type change struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// A GET is the method a page on another origin can be talked into
	// issuing, and this route writes. OriginGuard already stands in front of
	// it; requiring POST means the guard is not the only thing that does.
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "internal", "only POST is supported")
		return
	}

	var c change
	if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
		writeError(w, http.StatusBadRequest, "validation_error", "could not read the request body")
		return
	}
	if c.ID == "" {
		// `td update` takes its issue ids positionally. What it does when
		// given none is td's business, not something to find out from here.
		writeError(w, http.StatusBadRequest, "validation_error", "id is required")
		return
	}
	if !statuses[c.Status] {
		writeError(w, http.StatusBadRequest, "validation_error", "unknown status "+strconv.Quote(c.Status))
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()

	stdout, stderr, err := h.run(ctx, c)
	if ctx.Err() != nil && r.Context().Err() == nil {
		writeError(w, http.StatusGatewayTimeout, "internal",
			"td timed out after "+h.timeout.String())
		return
	}
	if msg := message(stderr); msg != "" {
		writeError(w, http.StatusBadRequest, "invalid_status", msg)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "td failed: "+err.Error())
		return
	}
	// td exits 0 whether it applied the change or refused it, so the streams
	// are the only signal: it confirms on stdout (UPDATED td-a1b2, UNSTARTED
	// td-a1b2 -> open) and refuses on stderr. Silence on both is neither, and
	// calling it success would leave the browser showing a status the
	// database does not have.
	if strings.TrimSpace(ansiRe.ReplaceAllString(stdout, "")) == "" {
		writeError(w, http.StatusInternalServerError, "internal",
			"td neither confirmed nor refused the status change")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"data": map[string]any{"id": c.ID, "status": c.Status},
	})
}

// run applies the change with the most specific command td has for it.
//
// `td unstart` and `td update --status open` both reach open, but only
// unstart records the move in the session log as "Reverted to open"; update
// writes nothing beyond updated_at. Where td has a word for what is
// happening, use it.
//
// unstart is narrower than the target, though: it reverts from in_progress
// and refuses from anywhere else ("issue not in_progress"), while update
// reaches open from in_review and closed as well. This route is told a target
// and not a source, so it tries the command that records the move and falls
// back to the one that works. Retrying is not a second write: a refusal
// leaves the issue untouched, which is what makes the fallback the first one.
//
// Both refusing is a genuine no, and unstart's wording is the one that names
// the obstacle — "already unstarted td-a1b2" against update's "invalid
// transition from open to open" — so that is the one kept.
func (h *handler) run(ctx context.Context, c change) (stdout, stderr string, err error) {
	if c.Status == "open" {
		out, errOut, runErr := h.exec(ctx, "unstart", "-w", h.baseDir, "--", c.ID)
		if message(errOut) == "" {
			return out, errOut, runErr
		}
		out2, errOut2, runErr2 := h.exec(ctx, "update", "-w", h.baseDir, "--status", "open", "--", c.ID)
		if message(errOut2) == "" {
			return out2, errOut2, runErr2
		}
		return out2, errOut, runErr
	}
	return h.exec(ctx, "update", "-w", h.baseDir, "--status", c.Status, "--", c.ID)
}

// exec runs one td command to completion.
//
// The id goes last, behind a --, for the reason tdquery documents: without
// the separator td's flag parser claims a leading-dash argument as its own.
func (h *handler) exec(ctx context.Context, args ...string) (stdout, stderr string, err error) {
	var out, errOut strings.Builder
	cmd := exec.CommandContext(ctx, h.td, args...)
	cmd.Stdout = &out
	cmd.Stderr = &errOut
	err = cmd.Run()
	return out.String(), errOut.String(), err
}

// message picks td's refusal out of stderr, decoloured and unlabelled.
func message(stderr string) string {
	for _, line := range strings.Split(ansiRe.ReplaceAllString(stderr, ""), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		return strings.TrimSpace(prefixRe.ReplaceAllString(line, ""))
	}
	return ""
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]any{
		"ok":    false,
		"error": map[string]any{"code": code, "message": msg},
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
