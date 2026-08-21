package tdstatus

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// stubTd writes an executable standing in for the td binary, whose behaviour
// is the POSIX shell fragment body. It also appends its own argv to the
// returned log, one element per line — the only way to prove what reached the
// process without a shell of our own in between. Same stub as tdquery's.
func stubTd(t *testing.T, body string) (path, argvLog string) {
	t.Helper()
	dir := t.TempDir()
	path = filepath.Join(dir, "td")
	argvLog = filepath.Join(dir, "argv.log")
	script := "#!/bin/sh\nfor a in \"$@\"; do printf '%s\\n' \"$a\" >>'" + argvLog + "'; done\n" + body + "\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path, argvLog
}

// argv reads back what the stub was called with. Absent means td never ran.
func argv(t *testing.T, argvLog string) []string {
	t.Helper()
	raw, err := os.ReadFile(argvLog)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	return strings.Split(strings.TrimSuffix(string(raw), "\n"), "\n")
}

// post runs one POST /gui/status with the given raw body.
func post(t *testing.T, h http.Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/gui/status", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// body is the JSON the frontend sends.
func body(id, status string) string {
	b, _ := json.Marshal(map[string]string{"id": id, "status": status})
	return string(b)
}

type envelope struct {
	OK   bool `json:"ok"`
	Data struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	} `json:"data"`
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) envelope {
	t.Helper()
	var env envelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return env
}

func testHandler(t *testing.T, td string) (*handler, string) {
	t.Helper()
	dir := t.TempDir()
	return &handler{td: td, baseDir: dir, timeout: 5 * time.Second}, dir
}

// td unstart is the only command that records the move in the session log
// ("Reverted to open"); td update --status open reaches the same status
// silently. Reaching for the more specific command is the whole reason this
// route knows about two of them.
func TestHandlerUnstartsWhenTheTargetIsOpen(t *testing.T) {
	td, log := stubTd(t, "printf 'UNSTARTED td-a1b2 → open\\n'")
	h, dir := testHandler(t, td)

	rec := post(t, h, body("td-a1b2", "open"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %q)", rec.Code, rec.Body.String())
	}
	want := []string{"unstart", "-w", dir, "--", "td-a1b2"}
	if got := argv(t, log); strings.Join(got, " ") != strings.Join(want, " ") {
		t.Errorf("argv = %q, want %q", got, want)
	}
}

// The id goes behind a --, for the reason tdquery documents: without the
// separator td's flag parser claims a leading-dash argument as its own.
func TestHandlerUpdatesTheStatusForEveryOtherTarget(t *testing.T) {
	td, log := stubTd(t, "printf 'UPDATED td-a1b2\\n'")
	h, dir := testHandler(t, td)

	rec := post(t, h, body("td-a1b2", "in_progress"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %q)", rec.Code, rec.Body.String())
	}
	want := []string{"update", "-w", dir, "--status", "in_progress", "--", "td-a1b2"}
	if got := argv(t, log); strings.Join(got, " ") != strings.Join(want, " ") {
		t.Errorf("argv = %q, want %q", got, want)
	}
}

// td unstart reverts from in_progress and refuses from anywhere else
// ("issue not in_progress"), while td update --status open reaches open from
// in_review and closed too. The route is told a target, not a source, so it
// tries the command that records the move and falls back to the one that
// works. The refusal wrote nothing, so the second attempt is the first write.
func TestHandlerFallsBackToUpdateWhenUnstartDoesNotApply(t *testing.T) {
	td, log := stubTd(t, `
case "$1" in
  unstart) printf 'Warning: issue not in_progress: td-a1b2 (status: in_review)\n' >&2 ;;
  update)  printf 'UPDATED td-a1b2\n' ;;
esac`)
	h, dir := testHandler(t, td)

	rec := post(t, h, body("td-a1b2", "open"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %q)", rec.Code, rec.Body.String())
	}
	want := []string{
		"unstart", "-w", dir, "--", "td-a1b2",
		"update", "-w", dir, "--status", "open", "--", "td-a1b2",
	}
	if got := argv(t, log); strings.Join(got, " ") != strings.Join(want, " ") {
		t.Errorf("argv = %q, want %q", got, want)
	}
}

// When neither command applies, unstart's wording is the one that names the
// real obstacle: "already unstarted td-a1b2" against update's "invalid
// transition from open to open".
func TestHandlerKeepsUnstartsWordingWhenBothRefuse(t *testing.T) {
	td, _ := stubTd(t, `
case "$1" in
  unstart) printf 'Warning: already unstarted td-a1b2\n' >&2 ;;
  update)  printf 'Warning: cannot update td-a1b2: invalid transition from open to open\n' >&2 ;;
esac`)
	h, _ := testHandler(t, td)

	env := decode(t, post(t, h, body("td-a1b2", "open")))

	if want := "already unstarted td-a1b2"; env.Error.Message != want {
		t.Errorf("message = %q, want %q", env.Error.Message, want)
	}
}

func TestHandlerAnswersWithTheStatusItSet(t *testing.T) {
	td, _ := stubTd(t, "printf 'UPDATED td-a1b2\\n'")
	h, _ := testHandler(t, td)

	env := decode(t, post(t, h, body("td-a1b2", "in_progress")))

	if !env.OK {
		t.Fatalf("ok = false, want true")
	}
	if env.Data.ID != "td-a1b2" || env.Data.Status != "in_progress" {
		t.Errorf("data = %+v, want id td-a1b2 and status in_progress", env.Data)
	}
}

// td exits 0 whether it applied the change or refused it, and says so on
// stderr alone: `td update --status` writes nothing to stdout when it refuses.
// The exit code carries no signal, so the streams are what decides.
func TestHandlerReportsTdsRefusalVerbatim(t *testing.T) {
	td, _ := stubTd(t, "printf 'Warning: cannot update td-a1b2: invalid transition from closed to blocked\\n' >&2")
	h, _ := testHandler(t, td)

	rec := post(t, h, body("td-a1b2", "blocked"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body %q)", rec.Code, rec.Body.String())
	}
	env := decode(t, rec)
	if want := "cannot update td-a1b2: invalid transition from closed to blocked"; env.Error.Message != want {
		t.Errorf("message = %q, want %q", env.Error.Message, want)
	}
}

// td colours its warnings, and marks a missing issue with ERROR: rather than
// Warning:. Both prefixes are CLI display artifacts; the sentence after them
// is td's answer and is what the user reads.
func TestHandlerStripsTdsPrefixAndColourFromTheMessage(t *testing.T) {
	td, _ := stubTd(t, "printf '\\033[38;5;214mERROR: issue not found: td-000000\\033[m\\n' >&2")
	h, _ := testHandler(t, td)

	env := decode(t, post(t, h, body("td-000000", "open")))

	if want := "issue not found: td-000000"; env.Error.Message != want {
		t.Errorf("message = %q, want %q", env.Error.Message, want)
	}
}

// A td that prints nothing at all has neither applied the change nor said
// why. Reporting that as success would leave the browser showing a status the
// database does not have.
func TestHandlerRefusesToCallSilenceSuccess(t *testing.T) {
	td, _ := stubTd(t, "exit 0")
	h, _ := testHandler(t, td)

	rec := post(t, h, body("td-a1b2", "in_progress"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body %q)", rec.Code, rec.Body.String())
	}
	if env := decode(t, rec); env.OK {
		t.Errorf("ok = true, want false")
	}
}

// The five statuses are checked here rather than left to td, because this is
// the value that reaches td's argv as a flag argument. Nothing else in
// td-gui predicts td's answer; this one keeps an arbitrary string out of a
// subprocess.
func TestHandlerRejectsAnUnknownStatusWithoutRunningTd(t *testing.T) {
	td, log := stubTd(t, "printf 'UPDATED td-a1b2\\n'")
	h, _ := testHandler(t, td)

	rec := post(t, h, body("td-a1b2", "--help"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body %q)", rec.Code, rec.Body.String())
	}
	if got := argv(t, log); got != nil {
		t.Errorf("td ran with %q, want no run at all", got)
	}
}

// `td update` takes its issue ids positionally. What it does when given none
// is td's business, and a stray request is not the way to find out.
func TestHandlerRejectsAnEmptyIDWithoutRunningTd(t *testing.T) {
	td, log := stubTd(t, "printf 'UPDATED\\n'")
	h, _ := testHandler(t, td)

	rec := post(t, h, body("", "in_progress"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body %q)", rec.Code, rec.Body.String())
	}
	if got := argv(t, log); got != nil {
		t.Errorf("td ran with %q, want no run at all", got)
	}
}

func TestHandlerRejectsABodyItCannotRead(t *testing.T) {
	td, log := stubTd(t, "printf 'UPDATED td-a1b2\\n'")
	h, _ := testHandler(t, td)

	rec := post(t, h, "not json")

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body %q)", rec.Code, rec.Body.String())
	}
	if got := argv(t, log); got != nil {
		t.Errorf("td ran with %q, want no run at all", got)
	}
}

// A write must not be reachable by a GET: this route changes an issue, and
// GET is the method a browser can be talked into issuing across origins.
func TestHandlerRefusesEveryMethodButPost(t *testing.T) {
	td, log := stubTd(t, "printf 'UPDATED td-a1b2\\n'")
	h, _ := testHandler(t, td)

	req := httptest.NewRequest(http.MethodGet, "/gui/status?id=td-a1b2&status=open", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405 (body %q)", rec.Code, rec.Body.String())
	}
	if got := argv(t, log); got != nil {
		t.Errorf("td ran with %q, want no run at all", got)
	}
}

// A td stuck on a locked database must not hold the request open: nothing
// downstream would release it, because the server's WriteTimeout is 0 so SSE
// can stream.
func TestHandlerReportsATimeoutRatherThanHanging(t *testing.T) {
	// exec, not a bare sleep: killed as a child of the shell it would keep the
	// output pipe open and the read would block for the full sleep anyway.
	td, _ := stubTd(t, "exec sleep 10")
	h, _ := testHandler(t, td)
	h.timeout = 100 * time.Millisecond

	start := time.Now()
	rec := post(t, h, body("td-a1b2", "in_progress"))
	elapsed := time.Since(start)

	if elapsed > 5*time.Second {
		t.Fatalf("handler did not respect its timeout: took %s", elapsed)
	}
	if rec.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want 504 (body %q)", rec.Code, rec.Body.String())
	}
	if env := decode(t, rec); !strings.Contains(env.Error.Message, "timed out") {
		t.Errorf("message = %q, want it to mention the timeout", env.Error.Message)
	}
}
