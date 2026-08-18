// Package tdquery runs one-off TDQ queries through the td CLI.
//
// td serve v0.57.0 exposes no query route: /v1/issues filters on status,
// type, priority, search and limit, ignores every other parameter, and a
// request to /v1/query is a 404. TDQ lives in `td query` alone, so an ad-hoc
// query needs a subprocess.
//
// This is the one read in td-gui that does not go through td serve. It is
// still td's own binary reading td's own database — no schema knowledge here,
// no writes — and it disappears the day td serve grows a query endpoint
// (td-894042 upstream). Nothing else should follow it out of the proxy.
package tdquery

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

// runTimeout bounds one query, in the spirit of tdbin.versionTimeout: a td
// that hangs on a locked database must not hold the request open, because
// nothing downstream would ever release it — the server's WriteTimeout is 0
// so SSE can stream.
const runTimeout = 10 * time.Second

// ansiRe matches the SGR sequences td colours its stderr with.
var ansiRe = regexp.MustCompile(`\x1b\[[0-9;]*m`)

// errorLineRe matches td's own error line on stderr, after decolouring, and
// captures what it has to say. The ERROR: prefix is a CLI display artifact —
// dropping it is what makes this fallback read like the --json path, which
// carries the same sentence without one.
var errorLineRe = regexp.MustCompile(`(?i)^ERROR:\s*(.+)$`)

type handler struct {
	td      string
	baseDir string
	timeout time.Duration
}

// Handler answers GET /gui/query?q=<tdq> with the ids the query matches.
//
// Deliberately not under /v1/: that prefix is td's API, proxied wholesale, and
// this is not td. The /gui/ prefix marks the exact code to delete once td
// answers queries itself.
func Handler(td, baseDir string) http.Handler {
	return &handler{td: td, baseDir: baseDir, timeout: runTimeout}
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "internal", "only GET is supported")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()

	q := r.URL.Query().Get("q")
	ids, runErr := h.ids(ctx, q)
	if runErr != nil {
		if ctx.Err() != nil && r.Context().Err() == nil {
			writeError(w, http.StatusGatewayTimeout, "internal",
				"td query timed out after "+h.timeout.String())
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_query", h.message(r.Context(), q, runErr))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"data": map[string]any{"ids": ids},
	})
}

// runResult is what one `td query` run left behind.
type runResult struct {
	stdout string
	stderr string
	err    error
}

func (e *runResult) Error() string { return e.err.Error() }

// ids runs the query and returns the ids td printed.
//
// The query goes last, behind a --, so a q of "--help" or "-o" reaches td as a
// query rather than as a flag of ours. Without the separator td's flag parser
// claims it: "--help" prints the help text on stdout and exits 0, which would
// come back as a screenful of phantom ids, and "-o" swallows the "ids" we
// asked for and returns the coloured table instead.
func (h *handler) ids(ctx context.Context, q string) ([]string, error) {
	res := h.run(ctx, "-o", "ids", "-n", "0", "-w", h.baseDir, "--", q)
	if res.err != nil {
		return nil, res
	}
	return parseIDs(res.stdout), nil
}

// message turns a failed run into the sentence the browser shows.
//
// On a syntax error `td query -o ids` writes nothing to stdout and an
// ANSI-coloured ERROR line plus its entire usage block to stderr. --json
// prints the same failure as one clean object instead, so the query is run a
// second time to ask for it. That second process is paid only when the query
// was already broken, and it buys td's exact wording rather than scraped text.
//
// --json cannot simply replace -o ids on the happy path: it overrides the
// output format and returns whole issue objects.
func (h *handler) message(ctx context.Context, q string, runErr error) string {
	var res *runResult
	if !errors.As(runErr, &res) {
		return runErr.Error()
	}

	ctx, cancel := context.WithTimeout(ctx, h.timeout)
	defer cancel()
	if msg := jsonError(h.run(ctx, "--json", "-n", "0", "-w", h.baseDir, "--", q).stdout); msg != "" {
		return msg
	}
	if msg := stderrError(res.stderr); msg != "" {
		return msg
	}
	return "td query failed: " + res.err.Error()
}

func (h *handler) run(ctx context.Context, args ...string) *runResult {
	var stdout, stderr strings.Builder
	cmd := exec.CommandContext(ctx, h.td, append([]string{"query"}, args...)...)
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	return &runResult{stdout: stdout.String(), stderr: stderr.String(), err: err}
}

// parseIDs reads td's `-o ids` output, one id per line.
//
// Ids never contain whitespace, so a line that does is td talking to a human,
// not an id — today that is the literal "No issues matching query", which it
// prints on stdout while exiting 0 when a valid query matches nothing.
// Filtering on the shape rather than on that exact sentence means a notice td
// adds later is dropped too, instead of arriving as a row that resolves to
// nothing.
func parseIDs(stdout string) []string {
	ids := []string{}
	for _, line := range strings.Split(stdout, "\n") {
		line = strings.TrimSpace(ansiRe.ReplaceAllString(line, ""))
		if line == "" || strings.ContainsAny(line, " \t") {
			continue
		}
		ids = append(ids, line)
	}
	return ids
}

// jsonError reads the object `td query --json` prints on stdout when it
// fails: {"error":{"code":"invalid_input","message":"parse error at ..."}}.
func jsonError(stdout string) string {
	var body struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(stdout)), &body); err != nil {
		return ""
	}
	return strings.TrimSpace(body.Error.Message)
}

// stderrError picks td's ERROR line out of the usage block that follows it.
func stderrError(stderr string) string {
	for _, line := range strings.Split(ansiRe.ReplaceAllString(stderr, ""), "\n") {
		if m := errorLineRe.FindStringSubmatch(strings.TrimSpace(line)); m != nil {
			return strings.TrimSpace(m[1])
		}
	}
	return ""
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"ok":    false,
		"error": map[string]any{"code": code, "message": message},
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
