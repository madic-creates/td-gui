package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestServesIndex(t *testing.T) {
	h, err := Handler()
	if err != nil {
		t.Skipf("no web build embedded: %v", err)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("GET / status = %d, want 200", rec.Code)
	}
}

// TestFallsBackToIndexForRoutes covers client-side routing: a deep link must
// return index.html, not 404, or reloading /issues/td-1 breaks.
func TestFallsBackToIndexForRoutes(t *testing.T) {
	h, err := Handler()
	if err != nil {
		t.Skipf("no web build embedded: %v", err)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/issues/td-abc123", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("GET /issues/td-abc123 status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "text/html") {
		t.Errorf("Content-Type = %q, want text/html", ct)
	}
}

// TestMissingAssetIsNotFound guards against the fallback swallowing genuine
// 404s for assets, which would turn a broken bundle into a blank page.
func TestMissingAssetIsNotFound(t *testing.T) {
	h, err := Handler()
	if err != nil {
		t.Skipf("no web build embedded: %v", err)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/assets/missing.js", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("GET /assets/missing.js status = %d, want 404", rec.Code)
	}
}
