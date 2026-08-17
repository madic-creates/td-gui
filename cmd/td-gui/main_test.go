package main

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/http"
	"os/exec"
	"runtime"
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

// TestStartAndReapWaitsOnTheChild pins that startAndReap reaps the process it
// starts instead of leaving it a zombie until td-gui itself exits — the bug
// openBrowser had when it called cmd.Start() without ever calling Wait().
// Reading cmd.ProcessState only after <-done is what makes this race-free:
// that receive happens-after the close(done) in startAndReap's goroutine,
// which happens-after the Wait() call that sets ProcessState.
func TestStartAndReapWaitsOnTheChild(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses a Unix shell command")
	}
	cmd := exec.Command("sh", "-c", "exit 0")
	done, err := startAndReap(cmd)
	if err != nil {
		t.Fatalf("startAndReap: %v", err)
	}

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("startAndReap did not reap the child within 3s")
	}

	if cmd.ProcessState == nil {
		t.Fatal("ProcessState is nil after <-done, want it set by Wait")
	}
	if !cmd.ProcessState.Exited() {
		t.Error("ProcessState.Exited() = false, want true")
	}
}

// TestStartAndReapReturnsStartError pins that a Start failure (e.g. a
// nonexistent binary) is reported rather than silently discarded.
func TestStartAndReapReturnsStartError(t *testing.T) {
	cmd := exec.Command("td-gui-nonexistent-binary-for-test")
	if _, err := startAndReap(cmd); err == nil {
		t.Error("startAndReap with a nonexistent binary: want error, got nil")
	}
}
