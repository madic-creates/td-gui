package proxy

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
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
