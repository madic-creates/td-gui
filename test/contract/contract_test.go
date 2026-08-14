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
