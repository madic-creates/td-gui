package proxy

import (
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
)

// New returns a reverse proxy to targetBaseURL that injects the bearer token
// on every request.
//
// FlushInterval is -1 so responses are written through immediately. td's SSE
// endpoint (/v1/events) holds a response open indefinitely; with the default
// buffering the browser would receive nothing until the connection closed and
// live updates would silently never arrive.
func New(targetBaseURL, token string) (http.Handler, error) {
	target, err := url.Parse(targetBaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse target URL %q: %w", targetBaseURL, err)
	}
	if target.Scheme == "" || target.Host == "" {
		return nil, fmt.Errorf("target URL %q needs a scheme and host", targetBaseURL)
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
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"ok":false,"error":{"code":"internal","message":"td serve is not reachable"}}`))
		},
	}
	return rp, nil
}
