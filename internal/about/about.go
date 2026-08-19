// Package about reports what this td-gui process is: where it is pointed,
// what versions are running, and where its source lives.
//
// Every fact here is already known at startup and was, until this package,
// printed to stderr and discarded — the browser is where a user is actually
// looking, and it was the one place none of it reached.
//
// Deliberately not under /v1/: that prefix is td's API, proxied wholesale,
// and td has no opinion about td-gui's build version. Unlike the other /gui/
// route this one is permanent — it runs no subprocess, opens no database, and
// reads nothing of td's, so there is no endpoint td could grow that replaces
// it.
package about

import (
	"encoding/json"
	"net/http"
)

// Info is fixed for the life of the process. It is gathered once, in main,
// and copied into the handler.
type Info struct {
	Project  string `json:"project"`  // the td project directory, absolute
	TdGui    string `json:"td_gui"`   // buildVersion; "dev" outside a release build
	Td       string `json:"td"`       // what `td --version` reported at startup
	TdPath   string `json:"td_path"`  // the located binary, after any --td override
	Go       string `json:"go"`       // runtime.Version()
	Platform string `json:"platform"` // GOOS/GOARCH
	Source   string `json:"source"`   // repository URL
	License  string `json:"license"`
}

// BackendState is the part that does not hold still: Supervise respawns a
// backend that died, which moves the URL and flips Owned from false to true.
//
// Declared here rather than taking a *backend.Manager both to keep this
// package free of that dependency and because the narrower type is the point
// — Manager also has a Token method, and an interface that does not name it
// cannot leak it.
type BackendState interface {
	BaseURL() string
	Owned() bool
}

type handler struct {
	info  Info
	state BackendState
}

// Handler answers GET /gui/about.
func Handler(info Info, state BackendState) http.Handler {
	return &handler{info: info, state: state}
}

// payload is Info plus the live backend block. The nesting is not decoration:
// it is the difference between the values the page may cache and the one it
// may not, and a flat object would hide that from the next reader.
type payload struct {
	Info
	Backend backendPayload `json:"backend"`
}

type backendPayload struct {
	URL   string `json:"url"`
	Owned bool   `json:"owned"`
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{
			"ok":    false,
			"error": map[string]any{"code": "internal", "message": "only GET is supported"},
		})
		return
	}

	// Read per request, not once at construction: that is the whole reason
	// this is an interface and not two strings.
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true,
		"data": payload{
			Info: h.info,
			Backend: backendPayload{
				URL:   h.state.BaseURL(),
				Owned: h.state.Owned(),
			},
		},
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
