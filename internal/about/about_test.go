package about

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeState stands in for *backend.Manager. It carries a Token method that
// the Manager also has and that BackendState deliberately does not name, so
// the leak test below is checking a handler that genuinely had a token within
// reach of the value it was handed.
type fakeState struct {
	url   string
	owned bool
	token string
}

func (f fakeState) BaseURL() string { return f.url }
func (f fakeState) Owned() bool     { return f.owned }
func (f fakeState) Token() string   { return f.token }

func testInfo() Info {
	return Info{
		Project:  "/home/you/proj",
		TdGui:    "v1.2.3",
		Td:       "v0.57.0",
		TdPath:   "/home/you/go/bin/td",
		Go:       "go1.24.0",
		Platform: "linux/amd64",
		Source:   "https://github.com/madic-creates/td-gui",
		License:  "Apache-2.0",
	}
}

type envelope struct {
	OK   bool `json:"ok"`
	Data struct {
		Project  string `json:"project"`
		TdGui    string `json:"td_gui"`
		Td       string `json:"td"`
		TdPath   string `json:"td_path"`
		Go       string `json:"go"`
		Platform string `json:"platform"`
		Source   string `json:"source"`
		License  string `json:"license"`
		Backend  struct {
			URL   string `json:"url"`
			Owned bool   `json:"owned"`
		} `json:"backend"`
	} `json:"data"`
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func do(t *testing.T, h http.Handler, method string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, "/gui/about", nil))
	return rec
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) envelope {
	t.Helper()
	var env envelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return env
}

func TestHandlerReportsEveryField(t *testing.T) {
	state := fakeState{url: "http://127.0.0.1:41234", owned: true, token: "s3cr3t"}
	rec := do(t, Handler(testInfo(), state), http.MethodGet)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", got)
	}

	env := decode(t, rec)
	if !env.OK {
		t.Errorf("ok = false, want true")
	}
	want := testInfo()
	for _, c := range []struct{ field, got, want string }{
		{"project", env.Data.Project, want.Project},
		{"td_gui", env.Data.TdGui, want.TdGui},
		{"td", env.Data.Td, want.Td},
		{"td_path", env.Data.TdPath, want.TdPath},
		{"go", env.Data.Go, want.Go},
		{"platform", env.Data.Platform, want.Platform},
		{"source", env.Data.Source, want.Source},
		{"license", env.Data.License, want.License},
		{"backend.url", env.Data.Backend.URL, state.url},
	} {
		if c.got != c.want {
			t.Errorf("%s = %q, want %q", c.field, c.got, c.want)
		}
	}
}

// Owned is the one value the handler must read per request rather than once
// at startup: Supervise flips it when it respawns a backend that died.
func TestHandlerReportsOwnedBothWays(t *testing.T) {
	for _, owned := range []bool{true, false} {
		rec := do(t, Handler(testInfo(), fakeState{url: "http://127.0.0.1:1", owned: owned}), http.MethodGet)
		if got := decode(t, rec).Data.Backend.Owned; got != owned {
			t.Errorf("owned = %v, want %v", got, owned)
		}
	}
}

func TestHandlerReadsBackendStatePerRequest(t *testing.T) {
	state := &mutableState{url: "http://127.0.0.1:1"}
	h := Handler(testInfo(), state)

	if got := decode(t, do(t, h, http.MethodGet)).Data.Backend.Owned; got {
		t.Fatalf("owned = true before the restart, want false")
	}
	state.url, state.owned = "http://127.0.0.1:2", true
	got := decode(t, do(t, h, http.MethodGet)).Data.Backend
	if !got.Owned || got.URL != "http://127.0.0.1:2" {
		t.Errorf("backend = %+v after the restart, want the new url and owned", got)
	}
}

type mutableState struct {
	url   string
	owned bool
}

func (m *mutableState) BaseURL() string { return m.url }
func (m *mutableState) Owned() bool     { return m.owned }

func TestHandlerRejectsNonGET(t *testing.T) {
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch} {
		rec := do(t, Handler(testInfo(), fakeState{}), method)
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s status = %d, want 405", method, rec.Code)
		}
		if env := decode(t, rec); env.OK || env.Error.Message == "" {
			t.Errorf("%s body = %+v, want an error envelope with a message", method, env)
		}
	}
}

// The first td-gui route that reports its own internals. Nothing in Info is
// close to a token today; this is here so the field that would be does not
// arrive unnoticed.
func TestHandlerNeverLeaksTheToken(t *testing.T) {
	const token = "b3ar3r-t0k3n-value"
	rec := do(t, Handler(testInfo(), fakeState{url: "http://127.0.0.1:41234", owned: true, token: token}), http.MethodGet)

	body := rec.Body.String()
	if strings.Contains(body, token) {
		t.Errorf("body contains the token: %s", body)
	}
	if strings.Contains(strings.ToLower(body), "token") {
		t.Errorf("body mentions a token: %s", body)
	}
}
