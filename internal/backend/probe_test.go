package backend

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestProbeUsable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/health":
			w.Write([]byte(`{"ok":true,"data":{"status":"ok"}}`))
		case "/v1/labels":
			w.Write([]byte(`{"ok":true,"data":{"labels":[]}}`))
		default:
			t.Errorf("unexpected probe path %q", r.URL.Path)
		}
	}))
	defer srv.Close()

	if got := Probe(context.Background(), srv.Client(), srv.URL); got != ProbeUsable {
		t.Errorf("Probe = %v, want ProbeUsable", got)
	}
}

func TestProbeUnauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.Write([]byte(`{"ok":true,"data":{"status":"ok"}}`))
			return
		}
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"ok":false,"error":{"code":"unauthorized"}}`))
	}))
	defer srv.Close()

	if got := Probe(context.Background(), srv.Client(), srv.URL); got != ProbeUnauthorized {
		t.Errorf("Probe = %v, want ProbeUnauthorized", got)
	}
}

func TestProbeUnhealthy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	if got := Probe(context.Background(), srv.Client(), srv.URL); got != ProbeDead {
		t.Errorf("Probe = %v, want ProbeDead", got)
	}
}

func TestProbeNoListener(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	url := srv.URL
	srv.Close() // nothing is listening now

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if got := Probe(ctx, http.DefaultClient, url); got != ProbeDead {
		t.Errorf("Probe = %v, want ProbeDead", got)
	}
}
