package main

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/http"
	"testing"
	"time"
)

// TestServeShutsDownWhileAStreamIsOpen is the load-bearing test for Ctrl-C
// latency. The UI always holds td's SSE endpoint open, and Shutdown waits for
// in-flight handlers without cancelling them, so without the cancellable base
// context this takes the full shutdown timeout — and td serve, still holding
// that stream open, then sits out its own grace period on top.
func TestServeShutsDownWhileAStreamIsOpen(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}

	streaming := make(chan struct{})
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "id: 1\ndata: {}\n\n")
		w.(http.Flusher).Flush()
		close(streaming)
		<-r.Context().Done() // an SSE stream ends only when the client goes away
	})

	ctx, stop := context.WithCancel(context.Background())
	defer stop()
	done := make(chan error, 1)
	go func() { done <- serve(ctx, ln, handler) }()

	resp, err := (&http.Client{Timeout: 5 * time.Second}).Get("http://" + ln.Addr().String() + "/v1/events")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if _, err := bufio.NewReader(resp.Body).ReadString('\n'); err != nil {
		t.Fatalf("read first SSE line: %v", err)
	}
	<-streaming

	start := time.Now()
	stop()
	select {
	case err := <-done:
		if err != nil {
			t.Errorf("serve returned %v, want nil", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("serve did not return within 3s while an SSE stream was open")
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Errorf("shutdown took %s, want well under a second", elapsed)
	}
}

// TestServeReturnsListenerErrors keeps the Serve error path wired to the caller
// instead of being swallowed by the shutdown path.
func TestServeReturnsListenerErrors(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ln.Close() // Serve fails immediately on a closed listener

	done := make(chan error, 1)
	go func() { done <- serve(context.Background(), ln, http.NotFoundHandler()) }()

	select {
	case err := <-done:
		if err == nil {
			t.Error("serve on a closed listener: want error, got nil")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("serve did not return after Serve failed")
	}
}
