package contract

import (
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"testing"
)

// requireRevisions skips unless td reports issue_revisions, which td-gui gates
// If-Match on rather than on a version number. td before v0.66.0 has no
// /v1/project at all.
func requireRevisions(t *testing.T, front string) {
	t.Helper()
	resp, err := http.Get(front + "/v1/project")
	if err != nil {
		t.Fatalf("GET /v1/project: %v", err)
	}
	defer resp.Body.Close()
	var body struct {
		Data struct {
			Capabilities []string `json:"capabilities"`
		} `json:"data"`
	}
	if resp.StatusCode == http.StatusNotFound {
		t.Skip("td has no /v1/project, so no issue revisions")
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode /v1/project: %v", err)
	}
	if !slices.Contains(body.Data.Capabilities, "issue_revisions") {
		t.Skipf("td does not report issue_revisions: %v", body.Data.Capabilities)
	}
}

func revisionOf(t *testing.T, front, id string) string {
	t.Helper()
	var detail struct {
		Data struct {
			Issue struct {
				Revision string `json:"revision"`
			} `json:"issue"`
		} `json:"data"`
	}
	getJSON(t, front+"/v1/issues/"+id, &detail)
	if detail.Data.Issue.Revision == "" {
		t.Fatal("issue detail carries no revision although td reports issue_revisions")
	}
	return detail.Data.Issue.Revision
}

// send issues a write with a quoted If-Match, the form web/src/api/mutations.ts
// sends, and returns the status code and td's error code.
func send(t *testing.T, method, url, body, revision string) (int, string) {
	t.Helper()
	req, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("If-Match", `"`+revision+`"`)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	defer resp.Body.Close()
	var envelope struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&envelope)
	return resp.StatusCode, envelope.Error.Code
}

// TestRevisionConflictContract pins what the GUI's conflict handling renders:
// every write td-gui sends a revision with is refused with 409 `conflict` when
// that revision is stale, through the proxy, and leaves the issue unchanged.
// A current revision is accepted and moves the issue to a new one.
func TestRevisionConflictContract(t *testing.T) {
	front, id := newProject(t)
	requireRevisions(t, front)
	issue := front + "/v1/issues/" + id

	stale := revisionOf(t, front, id)
	if code, _ := send(t, http.MethodPatch, issue, `{"sprint":"S1"}`, stale); code != http.StatusOK {
		t.Fatalf("PATCH with the current revision = %d, want 200", code)
	}
	current := revisionOf(t, front, id)
	if current == stale {
		t.Fatal("revision unchanged after a PATCH")
	}

	writes := []struct{ method, path, body string }{
		{http.MethodPatch, "", `{"sprint":"S2"}`},
		{http.MethodPost, "/start", `{}`},
		{http.MethodPost, "/reviews", `{"decision":"approved","summary":"fine"}`},
		{http.MethodDelete, "", ``},
	}
	for _, w := range writes {
		code, errCode := send(t, w.method, issue+w.path, w.body, stale)
		if code != http.StatusConflict || errCode != "conflict" {
			t.Errorf("%s %s with a stale revision = %d %q, want 409 \"conflict\"",
				w.method, w.path, code, errCode)
		}
	}
	if got := revisionOf(t, front, id); got != current {
		t.Error("a refused write changed the issue")
	}
}
