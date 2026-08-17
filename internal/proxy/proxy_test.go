package proxy

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"net"
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

// TestProxyErrorHandlerReturnsBadGateway pins the response a browser sees
// when the supervised td serve is unreachable (crashed, still starting up,
// mid-restart): a structured JSON 502 that the frontend's fetch calls can
// parse like any other API error, rather than a bare connection failure.
func TestProxyErrorHandlerReturnsBadGateway(t *testing.T) {
	// Reserve a port and immediately release it, so nothing is listening on
	// it and the proxy's round trip to it fails deterministically.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	unreachable := "http://" + ln.Addr().String()
	ln.Close()

	p, err := New(unreachable, "")
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

	if resp.StatusCode != http.StatusBadGateway {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusBadGateway)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want %q", ct, "application/json")
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	const want = `{"ok":false,"error":{"code":"internal","message":"td serve is not reachable"}}`
	if got := string(body); got != want {
		t.Errorf("body = %q, want %q", got, want)
	}
}

// TestProxyErrorHandlerLogsWithOption pins the one thing the JSON 502 body in
// TestProxyErrorHandlerReturnsBadGateway can't carry to an operator: why td
// serve was unreachable. Without WithErrorLog that reason went nowhere.
func TestProxyErrorHandlerLogsWithOption(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	unreachable := "http://" + ln.Addr().String()
	ln.Close()

	var log bytes.Buffer
	p, err := New(unreachable, "", WithErrorLog(&log))
	if err != nil {
		t.Fatal(err)
	}
	front := httptest.NewServer(p)
	defer front.Close()

	resp, err := front.Client().Get(front.URL + "/v1/issues")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()

	got := log.String()
	if !strings.Contains(got, "GET") || !strings.Contains(got, "/v1/issues") {
		t.Errorf("error log = %q, want it to mention the method and path", got)
	}
}

// TestProxyErrorHandlerDefaultLogsNothing pins that omitting WithErrorLog
// keeps prior behavior: no writer means no output, not a nil-pointer panic.
func TestProxyErrorHandlerDefaultLogsNothing(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	unreachable := "http://" + ln.Addr().String()
	ln.Close()

	p, err := New(unreachable, "")
	if err != nil {
		t.Fatal(err)
	}
	front := httptest.NewServer(p)
	defer front.Close()

	resp, err := front.Client().Get(front.URL + "/v1/issues")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
}

func TestNewRejectsBadURL(t *testing.T) {
	if _, err := New("://not a url", ""); err == nil {
		t.Error("New with malformed URL: want error, got nil")
	}
}
