package backend

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
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

func TestProbeUnusableWhenAuthenticatedReadFails(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.Write([]byte(`{"ok":true,"data":{"status":"ok"}}`))
			return
		}
		// Not 401 (unauthorized) and not 200 (usable): the process is up but
		// broken, e.g. a DB error on this specific request.
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	if got := Probe(context.Background(), srv.Client(), srv.URL); got != ProbeUnusable {
		t.Errorf("Probe = %v, want ProbeUnusable", got)
	}
}

// get closes each response body without draining it first. Go's Transport
// can only put a connection back in its keep-alive pool once the body has
// been read to EOF, so an unread-but-closed body forces a fresh TCP
// connection on the next request — costly for Probe, called on every
// possible-reuse Start(), and for the manager's health poll, called every
// ~100ms while a child starts up.
func TestGetReusesConnection(t *testing.T) {
	var newConns int32
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"ok":true,"data":{"status":"ok"}}`))
	}))
	srv.Config.ConnState = func(_ net.Conn, state http.ConnState) {
		if state == http.StateNew {
			atomic.AddInt32(&newConns, 1)
		}
	}
	srv.Start()
	defer srv.Close()

	client := srv.Client()
	for i := 0; i < 5; i++ {
		if _, ok := get(context.Background(), client, srv.URL+"/health"); !ok {
			t.Fatalf("get() failed on request %d", i)
		}
	}

	if got := atomic.LoadInt32(&newConns); got != 1 {
		t.Errorf("get() opened %d TCP connections for 5 requests, want 1 (reused)", got)
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
