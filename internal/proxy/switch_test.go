package proxy

import (
	"bufio"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSwitchRoutesToCurrentHandler(t *testing.T) {
	first := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("first"))
	})
	second := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("second"))
	})

	sw := NewSwitch(first)
	srv := httptest.NewServer(sw)
	defer srv.Close()

	if got := getBody(t, srv.URL); got != "first" {
		t.Errorf("body = %q, want %q", got, "first")
	}

	sw.Set(second)

	if got := getBody(t, srv.URL); got != "second" {
		t.Errorf("after Set, body = %q, want %q", got, "second")
	}
}

// TestSwitchDoesNotDisruptInFlightRequest pins the invariant Switch's own doc
// comment claims: swapping the handler must not drop a request already being
// served, since td-gui's own listener stays up across a supervised td serve
// restart specifically so an open SSE stream survives it. ServeHTTP loads the
// handler once per request, so a Set() mid-request must not affect that
// request's already-captured handler — only requests that arrive afterward.
func TestSwitchDoesNotDisruptInFlightRequest(t *testing.T) {
	release := make(chan struct{})
	first := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "id: 1\ndata: from-first\n\n")
		w.(http.Flusher).Flush()
		<-release // held open, as td's /v1/events stream is
	})
	second := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("second"))
	})

	sw := NewSwitch(first)
	srv := httptest.NewServer(sw)
	defer srv.Close()

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/v1/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	reader := bufio.NewReader(resp.Body)
	line, err := reader.ReadString('\n')
	if err != nil {
		t.Fatalf("read first SSE line: %v", err)
	}
	if got := strings.TrimSpace(line); got != "id: 1" {
		t.Fatalf("first line = %q, want %q", got, "id: 1")
	}

	// Swaps the handler while the request above is still open.
	sw.Set(second)

	// A fresh request now routes to the newly-set handler.
	if got := getBody(t, srv.URL); got != "second" {
		t.Errorf("after Set, new request body = %q, want %q", got, "second")
	}

	// The in-flight stream is unaffected by the swap: releasing it still lets
	// its response finish normally rather than being cut off.
	close(release)
	if _, err := io.ReadAll(reader); err != nil {
		t.Fatalf("read rest of in-flight stream: %v", err)
	}
}

func getBody(t *testing.T, url string) string {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}
