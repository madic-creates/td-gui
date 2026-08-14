// Package proxy fronts td serve with an origin guard and a streaming-safe
// reverse proxy.
package proxy

import (
	"net/http"
	"net/url"
)

// OriginGuard rejects browser requests that did not originate from
// allowedOrigin.
//
// Binding to loopback is not a security boundary against the browser: any web
// page can issue cross-origin requests to localhost. Requests carrying neither
// Origin nor Referer are allowed through — those are non-browser clients,
// which could invoke the td CLI directly anyway.
func OriginGuard(allowedOrigin string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" {
			if origin != allowedOrigin {
				deny(w)
				return
			}
			next.ServeHTTP(w, r)
			return
		}
		if referer := r.Header.Get("Referer"); referer != "" {
			u, err := url.Parse(referer)
			if err != nil || u.Scheme+"://"+u.Host != allowedOrigin {
				deny(w)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func deny(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	_, _ = w.Write([]byte(`{"ok":false,"error":{"code":"forbidden","message":"cross-origin request rejected"}}`))
}
