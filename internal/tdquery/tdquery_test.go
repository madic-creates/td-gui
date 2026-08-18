package tdquery

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
// process without a shell of our own in between.
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

// get runs one GET /gui/query?q=… against h and returns the recorder.
func get(t *testing.T, h http.Handler, q string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/gui/query?q="+urlEscape(q), nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func urlEscape(s string) string {
	return strings.NewReplacer(" ", "%20", "=", "%3D", "&", "%26", "+", "%2B", "#", "%23").Replace(s)
}

type envelope struct {
	OK   bool `json:"ok"`
	Data struct {
		IDs []string `json:"ids"`
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

func testHandler(t *testing.T, td string) *handler {
	t.Helper()
	return &handler{td: td, baseDir: t.TempDir(), timeout: 5 * time.Second}
}

func TestHandlerReturnsTheIDsTdPrinted(t *testing.T) {
	td, _ := stubTd(t, "printf 'td-13f058\\ntd-2b4bc9\\n'")

	rec := get(t, testHandler(t, td), "status = open")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %q)", rec.Code, rec.Body.String())
	}
	env := decode(t, rec)
	if !env.OK {
		t.Fatalf("ok = false, want true (body %q)", rec.Body.String())
	}
	if got, want := strings.Join(env.Data.IDs, ","), "td-13f058,td-2b4bc9"; got != want {
		t.Errorf("ids = %q, want %q", got, want)
	}
}

// td prints a human sentence on stdout — not an id — when a valid query
// matches nothing, and still exits 0. Read as an id it would surface as a
// phantom row that resolves to nothing.
func TestHandlerReadsTheNoMatchSentenceAsZeroIDs(t *testing.T) {
	td, _ := stubTd(t, "printf 'No issues matching query\\n'")

	rec := get(t, testHandler(t, td), "title ~ nothing")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %q)", rec.Code, rec.Body.String())
	}
	env := decode(t, rec)
	if len(env.Data.IDs) != 0 {
		t.Errorf("ids = %v, want none", env.Data.IDs)
	}
}

// A broken query exits 1 with an empty stdout and an ANSI-coloured ERROR line
// plus td's whole usage block on stderr. The re-run with --json is what turns
// that into one clean sentence.
func TestHandlerForwardsTdsOwnMessageFromTheJSONRerun(t *testing.T) {
	td, _ := stubTd(t, `
case " $* " in
  *" --json "*)
    printf '{"error":{"code":"invalid_input","message":"parse error at line 1, column 9: expected value"}}\n'
    exit 1 ;;
esac
printf '\033[38;5;196mERROR: Parse error: parse error at line 1, column 9: expected value\033[m\n' >&2
printf 'TDQ Syntax: field operator value\nUsage:\n  td query [expression] [flags]\n' >&2
exit 1`)

	rec := get(t, testHandler(t, td), "status =")

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body %q)", rec.Code, rec.Body.String())
	}
	env := decode(t, rec)
	if env.OK {
		t.Fatal("ok = true, want false")
	}
	if env.Error.Code != "invalid_query" {
		t.Errorf("code = %q, want %q", env.Error.Code, "invalid_query")
	}
	want := "parse error at line 1, column 9: expected value"
	if env.Error.Message != want {
		t.Errorf("message = %q, want %q", env.Error.Message, want)
	}
}

// If the --json re-run cannot be read either, the ERROR line off stderr is
// all there is. It must arrive without escape codes and without the usage
// block trailing it.
func TestHandlerFallsBackToTheStderrErrorLineWithoutANSI(t *testing.T) {
	td, _ := stubTd(t, `
printf '\033[38;5;196mERROR: Parse error: unexpected character\033[m\n' >&2
printf 'TDQ Syntax: field operator value\nUsage:\n  td query [expression] [flags]\n' >&2
exit 1`)

	rec := get(t, testHandler(t, td), "; ls")

	env := decode(t, rec)
	if env.OK {
		t.Fatal("ok = true, want false")
	}
	if strings.Contains(env.Error.Message, "\033") {
		t.Errorf("message = %q, want no ANSI escapes", env.Error.Message)
	}
	if strings.Contains(env.Error.Message, "Usage:") {
		t.Errorf("message = %q, want no usage block", env.Error.Message)
	}
	if !strings.Contains(env.Error.Message, "unexpected character") {
		t.Errorf("message = %q, want td's own wording", env.Error.Message)
	}
}

func TestHandlerTimesOutRatherThanHoldingTheRequestOpen(t *testing.T) {
	// exec, not a bare sleep: killed as a child of the shell it would keep the
	// output pipe open and the read would block for the full sleep anyway.
	td, _ := stubTd(t, "exec sleep 10")
	h := &handler{td: td, baseDir: t.TempDir(), timeout: 100 * time.Millisecond}

	start := time.Now()
	rec := get(t, h, "status = open")
	elapsed := time.Since(start)

	if elapsed > 5*time.Second {
		t.Fatalf("handler did not respect its timeout: took %s", elapsed)
	}
	if rec.Code != http.StatusGatewayTimeout {
		t.Errorf("status = %d, want 504 (body %q)", rec.Code, rec.Body.String())
	}
	if env := decode(t, rec); env.OK {
		t.Error("ok = true, want false")
	}
}

// The query is user input arriving over HTTP. It reaches td as one argv
// element after a --, so nothing in it can be read as a flag of ours and no
// shell ever sees it.
func TestHandlerPassesTheQueryAsOneArgvElementAfterTheSeparator(t *testing.T) {
	td, argvLog := stubTd(t, "printf ''")

	get(t, testHandler(t, td), "--help")

	raw, err := os.ReadFile(argvLog)
	if err != nil {
		t.Fatal(err)
	}
	args := strings.Split(strings.TrimSuffix(string(raw), "\n"), "\n")
	if len(args) < 2 {
		t.Fatalf("argv = %v, want the query at the end", args)
	}
	if got := args[len(args)-1]; got != "--help" {
		t.Errorf("last argv element = %q, want %q", got, "--help")
	}
	if got := args[len(args)-2]; got != "--" {
		t.Errorf("argv element before the query = %q, want %q — without it td parses the query as a flag", got, "--")
	}
}

func TestHandlerRunsQueryInTheProjectDirectory(t *testing.T) {
	td, argvLog := stubTd(t, "printf ''")
	h := testHandler(t, td)

	get(t, h, "status = open")

	raw, err := os.ReadFile(argvLog)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), h.baseDir) {
		t.Errorf("argv %q does not carry the project directory %q", raw, h.baseDir)
	}
}

func TestHandlerRejectsAnythingButGET(t *testing.T) {
	td, _ := stubTd(t, "printf ''")

	req := httptest.NewRequest(http.MethodPost, "/gui/query?q=status%20%3D%20open", nil)
	rec := httptest.NewRecorder()
	testHandler(t, td).ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", rec.Code)
	}
}

// The re-run that fetches td's wording must ask about the same query. Given
// no query at all td reports a different failure — or none, since an empty
// TDQ is legal and matches everything — and the browser would be told its
// broken query was fine.
func TestHandlerAsksTheJSONRerunAboutTheSameQuery(t *testing.T) {
	td, argvLog := stubTd(t, `
case " $* " in
  *" --json "*) printf '{"error":{"code":"invalid_input","message":"parse error"}}\n'; exit 1 ;;
esac
printf 'ERROR: Parse error\n' >&2
exit 1`)

	get(t, testHandler(t, td), "status =")

	raw, err := os.ReadFile(argvLog)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Count(string(raw), "status ="); got != 2 {
		t.Errorf("argv log carried the query %d times, want 2 (once per run):\n%s", got, raw)
	}
}
