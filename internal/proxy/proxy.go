package proxy

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
)

// Option configures a proxy built by New.
type Option func(*settings)

type settings struct {
	errorLog io.Writer
}

// WithErrorLog directs a line to w whenever the reverse proxy cannot reach
// targetBaseURL (connection refused, timeout, TLS failure, ...). The browser
// only ever sees the generic "td serve is not reachable" JSON body, so
// without this the underlying reason — the one thing an operator needs to
// tell "still starting up" from "crashed" from "wrong port" — goes nowhere.
// Omitting the option (the default) discards it, matching prior behavior.
func WithErrorLog(w io.Writer) Option {
	return func(s *settings) { s.errorLog = w }
}

// New returns a reverse proxy to targetBaseURL that injects the bearer token
// on every request.
//
// FlushInterval is -1 so responses are written through immediately. td's SSE
// endpoint (/v1/events) holds a response open indefinitely; with the default
// buffering the browser would receive nothing until the connection closed and
// live updates would silently never arrive.
func New(targetBaseURL, token string, opts ...Option) (http.Handler, error) {
	target, err := url.Parse(targetBaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse target URL %q: %w", targetBaseURL, err)
	}
	if target.Scheme == "" || target.Host == "" {
		return nil, fmt.Errorf("target URL %q needs a scheme and host", targetBaseURL)
	}

	var s settings
	for _, opt := range opts {
		opt(&s)
	}

	rp := &httputil.ReverseProxy{
		FlushInterval: -1,
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(target)
			// Never forward a client-supplied Authorization header; the token
			// is ours to set and the browser must never influence it.
			r.Out.Header.Del("Authorization")
			if token != "" {
				r.Out.Header.Set("Authorization", "Bearer "+token)
			}
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			if s.errorLog != nil {
				fmt.Fprintf(s.errorLog, "td-gui: proxy: %s %s: %v\n", r.Method, r.URL.Path, err)
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"ok":false,"error":{"code":"internal","message":"td serve is not reachable"}}`))
		},
	}
	return rp, nil
}
