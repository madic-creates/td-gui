package proxy

import (
	"net/http"
	"sync/atomic"
)

// Switch forwards to a handler that can be replaced at runtime.
//
// When the supervised td serve restarts it comes up on a new port with a new
// token, so the proxy built at startup is stale. Swapping the handler here
// avoids tearing down td-gui's own listener, which would drop the browser's
// SSE connection and every in-flight request.
type Switch struct {
	current atomic.Pointer[http.Handler]
}

// NewSwitch returns a Switch serving initial.
func NewSwitch(initial http.Handler) *Switch {
	s := &Switch{}
	s.Set(initial)
	return s
}

// Set replaces the handler for subsequent requests.
func (s *Switch) Set(h http.Handler) {
	s.current.Store(&h)
}

func (s *Switch) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h := s.current.Load()
	if h == nil {
		// http.Error would set Content-Type: text/plain, mismatching the JSON
		// body below; every other error envelope in this package (see
		// proxy.go's ErrorHandler) is written the same explicit way so
		// clients can rely on Content-Type matching the body they parse.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"ok":false,"error":{"code":"internal","message":"no backend"}}`))
		return
	}
	(*h).ServeHTTP(w, r)
}
