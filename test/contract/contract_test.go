package contract

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/madic-creates/td-gui/internal/backend"
	"github.com/madic-creates/td-gui/internal/proxy"
	"github.com/madic-creates/td-gui/internal/tdbin"
)

// newProject creates a temp td project with one issue and fronts it with the
// same proxy stack the real binary uses. It skips when td is unavailable so
// the suite stays runnable everywhere.
func newProject(t *testing.T) (frontURL string, issueID string) {
	t.Helper()

	td, err := tdbin.Locate("")
	if err != nil {
		t.Skipf("td not available: %v", err)
	}

	dir := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command(td, args...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("td %v failed: %v\n%s", args, err, out)
		}
	}
	run("init")
	run("create", "Contract test issue with a sufficiently long title", "--type", "feature", "--priority", "P1")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)

	mgr := backend.NewManager(backend.Config{BaseDir: dir, TdPath: td})
	if err := mgr.Start(ctx); err != nil {
		t.Fatalf("start backend: %v", err)
	}
	t.Cleanup(func() { _ = mgr.Stop() })

	api, err := proxy.New(mgr.BaseURL(), mgr.Token())
	if err != nil {
		t.Fatal(err)
	}
	front := httptest.NewServer(api)
	t.Cleanup(front.Close)

	var listBody struct {
		OK   bool `json:"ok"`
		Data struct {
			Issues []struct {
				ID string `json:"id"`
			} `json:"issues"`
		} `json:"data"`
	}
	getJSON(t, front.URL+"/v1/issues?limit=1", &listBody)
	if len(listBody.Data.Issues) == 0 {
		t.Fatal("no issues returned from a freshly seeded project")
	}
	return front.URL, listBody.Data.Issues[0].ID
}

func getJSON(t *testing.T, url string, into any) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET %s status = %d, want 200", url, resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(into); err != nil {
		t.Fatalf("decode %s: %v", url, err)
	}
}

// TestListContract pins the list envelope. td's response.go also defines a
// generic {items, pagination} shape that this endpoint does NOT use.
func TestListContract(t *testing.T) {
	front, _ := newProject(t)

	var body struct {
		OK   bool `json:"ok"`
		Data struct {
			Issues  []json.RawMessage `json:"issues"`
			Limit   *int              `json:"limit"`
			Offset  *int              `json:"offset"`
			Total   *int              `json:"total"`
			HasMore *bool             `json:"has_more"`
		} `json:"data"`
	}
	getJSON(t, front+"/v1/issues?limit=10", &body)

	if !body.OK {
		t.Error("ok = false, want true")
	}
	if body.Data.Limit == nil || body.Data.Offset == nil || body.Data.Total == nil || body.Data.HasMore == nil {
		t.Errorf("list envelope is missing pagination fields: %+v", body.Data)
	}
	if len(body.Data.Issues) == 0 {
		t.Error("issues is empty, want the seeded issue")
	}
}

// TestDetailContract pins every field web/src/api/types.ts relies on. A rename
// in td must fail here rather than surface as undefined in the UI.
func TestDetailContract(t *testing.T) {
	front, id := newProject(t)

	var body struct {
		Data struct {
			Issue         map[string]json.RawMessage `json:"issue"`
			Logs          []map[string]any           `json:"logs"`
			Comments      []map[string]any           `json:"comments"`
			Dependencies  []map[string]any           `json:"dependencies"`
			BlockedBy     []map[string]any           `json:"blocked_by"`
			LatestHandoff map[string]any             `json:"latest_handoff"`
		} `json:"data"`
	}
	getJSON(t, front+"/v1/issues/"+id, &body)

	if body.Data.Issue == nil {
		t.Fatal("data.issue is absent — the detail response nests the issue under `issue`")
	}
	required := []string{
		"id", "title", "description", "status", "type", "priority", "points",
		"labels", "parent_id", "acceptance", "sprint", "implementer_session",
		"creator_session", "reviewer_session", "created_at", "updated_at",
		"closed_at", "minor", "defer_count", "available_transitions",
	}
	for _, field := range required {
		if _, ok := body.Data.Issue[field]; !ok {
			t.Errorf("data.issue is missing field %q", field)
		}
	}
}

// TestCommentContract pins the request field name. It is `text`, not `body`;
// posting `body` fails validation silently from the caller's point of view.
func TestCommentContract(t *testing.T) {
	front, id := newProject(t)

	resp, err := http.Post(front+"/v1/issues/"+id+"/comments",
		"application/json", jsonBody(`{"text":"A contract test comment"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		t.Fatalf("POST comment status = %d, want 2xx", resp.StatusCode)
	}

	var detail struct {
		Data struct {
			Comments []struct {
				Text string `json:"text"`
			} `json:"comments"`
		} `json:"data"`
	}
	getJSON(t, front+"/v1/issues/"+id, &detail)
	if len(detail.Data.Comments) != 1 {
		t.Fatalf("got %d comments, want 1", len(detail.Data.Comments))
	}
	if detail.Data.Comments[0].Text != "A contract test comment" {
		t.Errorf("comment text = %q, want the posted text", detail.Data.Comments[0].Text)
	}
}

// TestValidationErrorContract pins the field-error shape the forms bind to.
func TestValidationErrorContract(t *testing.T) {
	front, _ := newProject(t)

	resp, err := http.Post(front+"/v1/issues", "application/json", jsonBody(`{"title":"ab"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}

	var body struct {
		OK    bool `json:"ok"`
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
			Details struct {
				Fields []struct {
					Field   string `json:"field"`
					Rule    string `json:"rule"`
					Message string `json:"message"`
				} `json:"fields"`
			} `json:"details"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Code != "validation_error" {
		t.Errorf("code = %q, want validation_error", body.Error.Code)
	}
	if len(body.Error.Details.Fields) == 0 {
		t.Fatal("details.fields is empty, want at least the title error")
	}
	f := body.Error.Details.Fields[0]
	if f.Field == "" || f.Rule == "" || f.Message == "" {
		t.Errorf("field error is missing parts: %+v", f)
	}
}

// TestApproveAttributionContract pins the approve request fields the detail
// view sends. The names are td's (`reviewed_by`, `self_review`), and td rejects
// the pair with a 400 whose wording the UI shows verbatim — so the UI offers
// them as mutually exclusive choices rather than relying on this round trip.
func TestApproveAttributionContract(t *testing.T) {
	front, id := newProject(t)

	resp, err := http.Post(front+"/v1/issues/"+id+"/approve", "application/json",
		jsonBody(`{"reviewed_by":"a reviewer","self_review":true}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for reviewed_by + self_review", resp.StatusCode)
	}

	var body struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(body.Error.Message, "mutually exclusive") {
		t.Errorf("message = %q, want td's mutual-exclusion wording", body.Error.Message)
	}
}

// TestRecordReviewContract pins the record-only path. Its note field is
// `summary`, not the `reason` the transition endpoints take — posting `reason`
// here fails as a missing summary.
func TestRecordReviewContract(t *testing.T) {
	front, id := newProject(t)

	resp, err := http.Post(front+"/v1/issues/"+id+"/reviews", "application/json",
		jsonBody(`{"decision":"approved","reason":"wrong field name"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 when summary is absent", resp.StatusCode)
	}

	var body struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(body.Error.Message, "summary") {
		t.Errorf("message = %q, want td to name the summary field", body.Error.Message)
	}
}

func jsonBody(s string) *strings.Reader { return strings.NewReader(s) }

// patchIssue sends a PATCH and returns the updated issue plus the status code.
func patchIssue(t *testing.T, front, id, body string) (map[string]any, int) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPatch, front+"/v1/issues/"+id,
		strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PATCH %s: %v", body, err)
	}
	defer resp.Body.Close()

	var envelope struct {
		Data struct {
			Issue map[string]any `json:"issue"`
		} `json:"data"`
		Error struct {
			Details struct {
				Fields []map[string]any `json:"fields"`
			} `json:"details"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode PATCH response: %v", err)
	}
	if resp.StatusCode >= 300 {
		return map[string]any{"__fields": len(envelope.Error.Details.Fields)}, resp.StatusCode
	}
	return envelope.Data.Issue, resp.StatusCode
}

// TestClearingContract pins the asymmetry web/src/features/issues/issueDiff.ts
// is built on: td reads a null on a nullable field as "field absent" and leaves
// the stored value alone, so only an empty string clears. If this ever flips,
// every clear in the GUI silently stops working — this test is what turns that
// into a failure.
func TestClearingContract(t *testing.T) {
	front, id := newProject(t)

	if _, status := patchIssue(t, front, id,
		`{"due_date":"2026-12-01","defer_until":"2026-11-01"}`); status != http.StatusOK {
		t.Fatalf("seeding dates: status = %d, want 200", status)
	}

	issue, status := patchIssue(t, front, id, `{"due_date":null,"defer_until":null}`)
	if status != http.StatusOK {
		t.Fatalf("null on a date: status = %d, want 200 — a rejection here is a "+
			"different regression than the no-op this test guards", status)
	}
	if issue["due_date"] == nil || issue["defer_until"] == nil {
		t.Error("null cleared a date; the GUI sends \"\" to clear because null is a no-op")
	}

	issue, status = patchIssue(t, front, id, `{"due_date":"","defer_until":""}`)
	if status != http.StatusOK {
		t.Fatalf("clearing with an empty string: status = %d, want 200 — if td now "+
			"rejects \"\" on a date the GUI's clear path is broken", status)
	}
	if issue["due_date"] != nil {
		t.Errorf("due_date = %v after an empty string, want null", issue["due_date"])
	}
	if issue["defer_until"] != nil {
		t.Errorf("defer_until = %v after an empty string, want null", issue["defer_until"])
	}
}

// TestPointsContract pins the inverse rule for points: 0 clears, and an empty
// string is a JSON type error carrying no field errors to bind to.
func TestPointsContract(t *testing.T) {
	front, id := newProject(t)

	if _, status := patchIssue(t, front, id, `{"points":5}`); status != http.StatusOK {
		t.Fatalf("seeding points: status = %d, want 200", status)
	}

	issue, status := patchIssue(t, front, id, `{"points":0}`)
	if status != http.StatusOK {
		t.Fatalf("clearing with 0: status = %d, want 200 — if td now rejects 0 on "+
			"points the GUI's clear path is broken", status)
	}
	if points, ok := issue["points"].(float64); !ok || points != 0 {
		t.Errorf("points = %v after 0, want 0", issue["points"])
	}

	result, status := patchIssue(t, front, id, `{"points":""}`)
	if status != http.StatusBadRequest {
		t.Errorf("status = %d for an empty points, want 400", status)
	}
	if result["__fields"] != 0 {
		t.Errorf("empty points returned %v field errors, want 0 — the form must "+
			"send a number because there is nothing to bind this to", result["__fields"])
	}
}

// TestDependencyContract pins the write shape and the field-less error the
// dependency panel renders as a message.
func TestDependencyContract(t *testing.T) {
	front, id := newProject(t)

	resp, err := http.Post(front+"/v1/issues/"+id+"/dependencies",
		"application/json", jsonBody(`{"depends_on":"`+id+`"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d for a self-dependency, want 400", resp.StatusCode)
	}

	var body struct {
		Error struct {
			Message string `json:"message"`
			Details struct {
				Fields []map[string]any `json:"fields"`
			} `json:"details"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(body.Error.Message, "circular") {
		t.Errorf("message = %q, want td's circular-dependency wording", body.Error.Message)
	}
	if len(body.Error.Details.Fields) != 0 {
		t.Errorf("got %d field errors, want 0 — the panel renders the message, "+
			"not a field binding", len(body.Error.Details.Fields))
	}
}

// TestFocusContract pins that focus is write-only. A GET would let the detail
// view show which issue is focused; while it 405s, the GUI must not claim to
// know.
func TestFocusContract(t *testing.T) {
	front, id := newProject(t)

	req, err := http.NewRequest(http.MethodPut, front+"/v1/focus",
		strings.NewReader(`{"issue_id":"`+id+`"}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT /v1/focus status = %d, want 200", resp.StatusCode)
	}

	read, err := http.Get(front + "/v1/focus")
	if err != nil {
		t.Fatal(err)
	}
	defer read.Body.Close()
	if read.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("GET /v1/focus status = %d, want 405 — if it now succeeds the detail "+
			"view can show real focus state instead of only acknowledging the write; "+
			"any other status is an unrelated routing regression", read.StatusCode)
	}
}
