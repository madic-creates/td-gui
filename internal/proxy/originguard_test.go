package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOriginGuard(t *testing.T) {
	const allowed = "http://127.0.0.1:7777"

	tests := []struct {
		name       string
		origin     string
		referer    string
		wantStatus int
	}{
		{"matching origin", allowed, "", http.StatusOK},
		{"no headers (curl)", "", "", http.StatusOK},
		{"foreign origin", "https://evil.example", "", http.StatusForbidden},
		{"foreign referer", "", "https://evil.example/page", http.StatusForbidden},
		{"matching referer", "", allowed + "/issues/td-1", http.StatusOK},
		{"null origin", "null", "", http.StatusForbidden},
		{"prefix lookalike", "http://127.0.0.1:7777.evil.example", "", http.StatusForbidden},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			})
			req := httptest.NewRequest(http.MethodPost, "/v1/issues", nil)
			if tt.origin != "" {
				req.Header.Set("Origin", tt.origin)
			}
			if tt.referer != "" {
				req.Header.Set("Referer", tt.referer)
			}
			rec := httptest.NewRecorder()
			OriginGuard(allowed, next).ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
		})
	}
}
