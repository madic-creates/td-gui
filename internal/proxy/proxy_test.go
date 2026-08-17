package proxy

import (
	"bufio"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestProxyInjectsToken(t *testing.T) {
	var gotAuth string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Write([]byte(`{"ok":true}`))
	}))
	defer upstream.Close()

	p, err := New(upstream.URL, "secrettoken")
	if err != nil {
		t.Fatal(err)
	}
	front := httptest.NewServer(p)
	defer front.Close()

	resp, err := front.Client().Get(front.URL + "/v1/issues")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if want := "Bearer secrettoken"; gotAuth != want {
		t.Errorf("upstream Authorization = %q, want %q", gotAuth, want)
	}
}

func TestProxyDoesNotLeakTokenToClient(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"ok":true}`))
	}))
	defer upstream.Close()

	p, err := New(upstream.URL, "secrettoken")
	if err != nil {
		t.Fatal(err)
	}
	front := httptest.NewServer(p)
	defer front.Close()

	resp, err := front.Client().Get(front.URL + "/v1/issues")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	for name, values := range resp.Header {
		for _, v := range values {
			if strings.Contains(v, "secrettoken") {
				t.Errorf("response header %s leaks the token: %q", name, v)
			}
		}
	}
}

func TestProxyOmitsAuthWhenNoToken(t *testing.T) {
	var hadAuth bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, hadAuth = r.Header["Authorization"]
		w.Write([]byte(`{"ok":true}`))
	}))
	defer upstream.Close()

	p, err := New(upstream.URL, "")
	if err != nil {
		t.Fatal(err)
	}
	front := httptest.NewServer(p)
	defer front.Close()

	resp, err := front.Client().Get(front.URL + "/v1/issues")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if hadAuth {
		t.Error("proxy sent an Authorization header despite an empty token")
	}
}

// TestProxyStripsClientSuppliedAuthorization pins the Rewrite hook's Del
// call. With a token configured, Set alone would already clobber a
// client-supplied header — but with no token configured (an instance td-gui
// is reusing rather than one it spawned) Set is skipped entirely, and Del is
// the only thing standing between an untrusted page's own Authorization
// header and the upstream.
func TestProxyStripsClientSuppliedAuthorization(t *testing.T) {
	var hadAuth bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, hadAuth = r.Header["Authorization"]
		w.Write([]byte(`{"ok":true}`))
	}))
	defer upstream.Close()

	p, err := New(upstream.URL, "")
	if err != nil {
		t.Fatal(err)
	}
	front := httptest.NewServer(p)
	defer front.Close()

	req, err := http.NewRequest(http.MethodGet, front.URL+"/v1/issues", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer attacker-supplied")

	resp, err := front.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if hadAuth {
		t.Error("proxy forwarded a client-supplied Authorization header upstream")
	}
}

// TestProxyStreamsSSE is the load-bearing test: with default buffering the
// browser would receive nothing until the stream closed, and live updates
// would silently never arrive.
func TestProxyStreamsSSE(t *testing.T) {
	release := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "id: 1\nevent: ping\ndata: {\"change_token\":\"1\"}\n\n")
		w.(http.Flusher).Flush()
		<-release // hold the response open
	}))
	defer upstream.Close()
	defer close(release)

	p, err := New(upstream.URL, "")
	if err != nil {
		t.Fatal(err)
	}
	front := httptest.NewServer(p)
	defer front.Close()

	req, _ := http.NewRequest(http.MethodGet, front.URL+"/v1/events", nil)
	resp, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	// The first event must arrive while the upstream response is still open.
	reader := bufio.NewReader(resp.Body)
	line, err := reader.ReadString('\n')
	if err != nil {
		t.Fatalf("read first SSE line: %v", err)
	}
	if got := strings.TrimSpace(line); got != "id: 1" {
		t.Errorf("first line = %q, want %q", got, "id: 1")
	}
}

func TestNewRejectsBadURL(t *testing.T) {
	if _, err := New("://not a url", ""); err == nil {
		t.Error("New with malformed URL: want error, got nil")
	}
}
