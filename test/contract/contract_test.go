package contract

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/madic-creates/td-gui/internal/backend"
	"github.com/madic-creates/td-gui/internal/proxy"
	"github.com/madic-creates/td-gui/internal/tdbin"
	"github.com/madic-creates/td-gui/internal/tdquery"
)

// TestMain scrubs inherited GIT_* environment variables before any test in
// this package runs.
//
// Every test here spawns real td processes against a throwaway project in a
// fresh temp directory: `td init` via run, and `td serve` via
// backend.Manager. td resolves its project root through git, and when
// GIT_DIR (and friends, e.g. GIT_INDEX_FILE) are inherited from a parent
// process — as git itself sets them for every hook it invokes, including
// this repo's own pre-commit go-test hook — `td init` walks that inherited
// git context instead of the process's actual working directory. This repo
// dogfoods td on itself, so its own .todos already exists at the repo root;
// under a leaked GIT_DIR, `td init` in a brand-new temp dir sees that
// pre-existing .todos, prints "Warning: .todos/ already exists", and exits
// 0 having created nothing in the temp dir. An explicit --work-dir does not
// help — verified separately, `td init --work-dir <dir>` still resolves via
// GIT_DIR and skips. The failure then surfaces one step later and out of
// context, as backend.Manager.Start's "not a td project (no .todos
// directory)", which makes every test in this package fail identically
// whenever the suite runs from inside a git hook — invisible without this
// note.
//
// Clearing GIT_* here, once, for the whole test binary process, is
// inherited by every exec.Command spawned without an explicit Env — both
// `run`'s and the one backend.Manager starts — without touching either
// helper or reaching into internal/backend. (Manager's own `td serve` turns
// out to be unaffected by a leaked GIT_DIR on its own, since it always
// passes --work-dir explicitly; it is scrubbed here anyway for the same
// package-wide guarantee, rather than leaving that immunity to depend on
// every future call always remembering the flag.)
func TestMain(m *testing.M) {
	var restore []func()
	for _, kv := range os.Environ() {
		name, value, ok := strings.Cut(kv, "=")
		if !ok || !strings.HasPrefix(name, "GIT_") {
			continue
		}
		os.Unsetenv(name)
		restore = append(restore, func() { os.Setenv(name, value) })
	}

	code := m.Run()

	for _, fn := range restore {
		fn()
	}
	os.Exit(code)
}

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

// TestListClosedContract pins that td reads an absent status filter as
// everything *except* closed, and hands closed issues over only when asked
// for them by name.
//
// useIssueIndex fires a second, status=closed request for exactly this
// reason: without it the issue index holds no closed issue, so the pickers
// cannot offer one as a dependency or a parent, and a blocker that is already
// finished renders as a bare id under "Depends on" rather than under
// "Resolved". If td ever starts including closed issues in the unfiltered
// list, this test is where that shows up — the second request then becomes
// redundant rather than load-bearing.
func TestListClosedContract(t *testing.T) {
	front, id := newProject(t)

	// One session drives every call here, so the approval has to declare
	// itself a self-review — td's policy refuses to let an implementer
	// approve their own work otherwise.
	if code := post(t, front+"/v1/issues/"+id+"/start", `{}`); code != http.StatusOK {
		t.Fatalf("start: status = %d", code)
	}
	if code := post(t, front+"/v1/issues/"+id+"/review", `{}`); code != http.StatusOK {
		t.Fatalf("review: status = %d", code)
	}
	if code := post(t, front+"/v1/issues/"+id+"/approve",
		`{"self_review":true,"reason":"pinning the closed-list shape"}`); code != http.StatusOK {
		t.Fatalf("approve: status = %d", code)
	}

	ids := func(url string) []string {
		t.Helper()
		var body struct {
			Data struct {
				Issues []struct {
					ID     string `json:"id"`
					Status string `json:"status"`
				} `json:"issues"`
			} `json:"data"`
		}
		getJSON(t, url, &body)
		var out []string
		for _, issue := range body.Data.Issues {
			out = append(out, issue.ID)
		}
		return out
	}

	// Asked for by name, it is there — so the failure below is "the filter is
	// gone", never "the issue never closed".
	if closed := ids(front + "/v1/issues?limit=1000&status=closed"); !slices.Contains(closed, id) {
		t.Fatalf("status=closed = %v, want the closed issue %s", closed, id)
	}
	if unfiltered := ids(front + "/v1/issues?limit=1000"); slices.Contains(unfiltered, id) {
		t.Errorf("unfiltered list = %v, which now includes the closed issue %s — "+
			"useIssueIndex's second status=closed request exists because it did not", unfiltered, id)
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

// post sends a JSON body and returns the status code, for the calls whose
// response shape does not matter to the assertion. postJSON already skips the
// decode on a nil target, so this is that call with the target named.
func post(t *testing.T, url, body string) int {
	t.Helper()
	return postJSON(t, url, body, nil)
}

// otherIssue returns the id of an issue in the project that is not notID. It
// reads the list rather than the create response, so it does not depend on the
// shape POST /v1/issues answers with.
func otherIssue(t *testing.T, front, notID string) string {
	t.Helper()
	var body struct {
		Data struct {
			Issues []struct {
				ID string `json:"id"`
			} `json:"issues"`
		} `json:"data"`
	}
	getJSON(t, front+"/v1/issues?limit=50", &body)
	for _, i := range body.Data.Issues {
		if i.ID != notID {
			return i.ID
		}
	}
	t.Fatal("no second issue in the project")
	return ""
}

// TestDependencyDirectionContract pins which end of a dependency row each
// field holds. One row appears on both issues: under `dependencies` on the
// issue that waits, and under `blocked_by` on the issue being waited for. The
// field named blocked_by therefore holds what this issue BLOCKS, not what
// blocks it — resolving the wrong end renders a panel that looks right and is
// backwards, which no type checker can catch.
func TestDependencyDirectionContract(t *testing.T) {
	front, subject := newProject(t)

	if code := post(t, front+"/v1/issues",
		`{"title":"A blocking issue with a sufficiently long title","type":"bug"}`); code != http.StatusCreated && code != http.StatusOK {
		t.Fatalf("create second issue: status = %d", code)
	}
	blocker := otherIssue(t, front, subject)

	if code := post(t, front+"/v1/issues/"+subject+"/dependencies",
		`{"depends_on":"`+blocker+`"}`); code != http.StatusCreated && code != http.StatusOK {
		t.Fatalf("add dependency: status = %d", code)
	}

	type dep struct {
		IssueID     string `json:"issue_id"`
		DependsOnID string `json:"depends_on_id"`
	}
	var subjectBody struct {
		Data struct {
			Dependencies []dep `json:"dependencies"`
			BlockedBy    []dep `json:"blocked_by"`
		} `json:"data"`
	}
	getJSON(t, front+"/v1/issues/"+subject, &subjectBody)

	if len(subjectBody.Data.Dependencies) != 1 {
		t.Fatalf("subject dependencies = %d, want 1", len(subjectBody.Data.Dependencies))
	}
	if got := subjectBody.Data.Dependencies[0].DependsOnID; got != blocker {
		t.Errorf("subject dependencies[0].depends_on_id = %q, want the blocker %q", got, blocker)
	}
	if len(subjectBody.Data.BlockedBy) != 0 {
		t.Errorf("subject blocked_by = %+v, want empty — nothing waits on the subject",
			subjectBody.Data.BlockedBy)
	}

	var blockerBody struct {
		Data struct {
			Dependencies []dep `json:"dependencies"`
			BlockedBy    []dep `json:"blocked_by"`
		} `json:"data"`
	}
	getJSON(t, front+"/v1/issues/"+blocker, &blockerBody)

	if len(blockerBody.Data.Dependencies) != 0 {
		t.Errorf("blocker dependencies = %+v, want empty — it waits for nothing",
			blockerBody.Data.Dependencies)
	}
	if len(blockerBody.Data.BlockedBy) != 1 {
		t.Fatalf("blocker blocked_by = %d, want 1", len(blockerBody.Data.BlockedBy))
	}
	if got := blockerBody.Data.BlockedBy[0].IssueID; got != subject {
		t.Errorf("blocker blocked_by[0].issue_id = %q, want the subject %q — this field holds what the issue blocks", got, subject)
	}
}

// TestActiveReviewContract pins that active_review is absent until a review
// exists. The issue description called it always present; it is not, and a
// review panel written against that claim renders an empty heading forever.
func TestActiveReviewContract(t *testing.T) {
	front, id := newProject(t)

	// Keyed at data.issue, not data: active_review hangs off the issue, one
	// level deeper than dependencies and blocked_by. Probing the envelope
	// instead would report "absent" forever, whatever the review state.
	var before struct {
		Data struct {
			Issue map[string]json.RawMessage `json:"issue"`
		} `json:"data"`
	}
	getJSON(t, front+"/v1/issues/"+id, &before)
	if len(before.Data.Issue) == 0 {
		t.Fatal("data.issue is empty — the assertion below would pass vacuously")
	}
	if _, present := before.Data.Issue["active_review"]; present {
		t.Errorf("active_review is present before any review: %s", before.Data.Issue["active_review"])
	}

	if code := post(t, front+"/v1/issues/"+id+"/start", `{}`); code != http.StatusOK {
		t.Fatalf("start: status = %d", code)
	}
	if code := post(t, front+"/v1/issues/"+id+"/review", `{}`); code != http.StatusOK {
		t.Fatalf("review: status = %d", code)
	}
	// self_review is required, not decoration: /reviews runs the same review
	// policy as /approve, and every call here shares one td session, so a bare
	// {decision, summary} is refused with "you implemented this issue".
	if code := post(t, front+"/v1/issues/"+id+"/reviews",
		`{"decision":"approved","summary":"pinning the review shape","self_review":true}`); code != http.StatusCreated && code != http.StatusOK {
		t.Fatalf("record review: status = %d", code)
	}

	type issueEnvelope struct {
		Data struct {
			Issue struct {
				ActiveReview *struct {
					ID              string `json:"id"`
					Decision        string `json:"decision"`
					ReviewerSession string `json:"reviewer_session"`
					Summary         string `json:"summary"`
					CreatedAt       string `json:"created_at"`
				} `json:"active_review"`
				Reviews []map[string]any `json:"reviews"`
			} `json:"issue"`
		} `json:"data"`
	}

	var after issueEnvelope
	getJSON(t, front+"/v1/issues/"+id, &after)
	if after.Data.Issue.ActiveReview == nil {
		t.Fatal("active_review is absent after a review was recorded")
	}
	if after.Data.Issue.ActiveReview.Decision != "approved" {
		t.Errorf("decision = %q, want approved", after.Data.Issue.ActiveReview.Decision)
	}
	for _, field := range []string{
		after.Data.Issue.ActiveReview.ID,
		after.Data.Issue.ActiveReview.ReviewerSession,
		after.Data.Issue.ActiveReview.Summary,
		after.Data.Issue.ActiveReview.CreatedAt,
	} {
		if field == "" {
			t.Errorf("active_review has an empty field: %+v", after.Data.Issue.ActiveReview)
		}
	}
	// History arrives only when asked for: unadorned, td sends no reviews at
	// all, so the field decodes to nil rather than an empty slice.
	if after.Data.Issue.Reviews != nil {
		t.Errorf("reviews is present without ?with=reviews: %v", after.Data.Issue.Reviews)
	}

	// Decoded into a fresh variable: json.Unmarshal leaves absent fields
	// untouched, so reusing `after` here would let a stale non-empty
	// `Reviews` from a previous decode pass this assertion vacuously.
	var withReviews issueEnvelope
	getJSON(t, front+"/v1/issues/"+id+"?with=reviews", &withReviews)
	if len(withReviews.Data.Issue.Reviews) == 0 {
		t.Error("reviews is empty under ?with=reviews, want the recorded review")
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

// postJSON posts and decodes the envelope, for the endpoints whose response
// body the caller needs rather than only its status.
func postJSON(t *testing.T, url, body string, into any) int {
	t.Helper()
	resp, err := http.Post(url, "application/json", jsonBody(body))
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()
	if into != nil {
		if err := json.NewDecoder(resp.Body).Decode(into); err != nil {
			t.Fatalf("decode %s: %v", url, err)
		}
	}
	return resp.StatusCode
}

// boardCard is one entry of a board's `issues` array, typed as
// web/src/api/types.ts declares it.
type boardCard struct {
	Issue struct {
		ID string `json:"id"`
	} `json:"issue"`
	BoardID     *string `json:"board_id"`
	Position    *int    `json:"position"`
	HasPosition *bool   `json:"has_position"`
}

// boardCardIDs reads a board and returns its card ids in the order td sorted
// them, checking on the way that every field the TypeScript Board and
// BoardCard types declare as required is actually present. Pointers, not
// values: an absent field decodes to the zero value, and `position` is
// legitimately 0 for the front card, so only nil distinguishes "td stopped
// sending this" from "td sent zero".
func boardCardIDs(t *testing.T, front, board string) []string {
	t.Helper()

	var got struct {
		Data struct {
			Board  map[string]json.RawMessage `json:"board"`
			Issues []boardCard                `json:"issues"`
		} `json:"data"`
	}
	getJSON(t, front+"/v1/boards/"+board, &got)

	for _, field := range []string{
		"id", "name", "query", "is_builtin", "view_mode",
		// Read as metadata rather than rendered, which is exactly why their
		// absence would not show up anywhere else.
		"last_viewed_at", "created_at", "updated_at",
	} {
		if _, ok := got.Data.Board[field]; !ok {
			t.Errorf("board is missing %q", field)
		}
	}

	ids := make([]string, 0, len(got.Data.Issues))
	for i, card := range got.Data.Issues {
		if card.BoardID == nil || *card.BoardID != board {
			t.Errorf("card %d board_id = %v, want %q", i, card.BoardID, board)
		}
		if card.Position == nil {
			t.Errorf("card %d has no position — it is the sparse sort key, and the "+
				"only field the cards are ordered by", i)
		}
		if card.HasPosition == nil || !*card.HasPosition {
			t.Errorf("card %d has_position = %v, want true", i, card.HasPosition)
		}
		ids = append(ids, card.Issue.ID)
	}
	return ids
}

// TestBoardPositionSlotContract pins the one thing the boards UI computes:
// POST /v1/boards/{id}/issues takes a 1-BASED SLOT among the cards that
// already have a position — INCLUDING the card being moved — while the
// position read back from the board is a sparse sort key.
//
// Three legs, in the order features/boards/position.ts stakes the feature on
// them:
//
//   - slot 1 puts a card at the front;
//   - moving a card down by one takes index + 2 as the gap, so the Move-down
//     button on index 0 sends slot 3 — at slot 2 td would interpolate between
//     the card and its successor and the card would keep its place. This leg
//     is why insertSlot exists; without it a future ComputeInsertPosition
//     change would turn Move-down into a silent no-op that the unit tests,
//     which encode the same assumption they verify, could never catch;
//   - a slot of pinned + 1 appends after the last positioned card.
//
// It also pins the response shape the cards are built from — see
// boardCardIDs.
func TestBoardPositionSlotContract(t *testing.T) {
	front, first := newProject(t)

	if status := post(t, front+"/v1/issues",
		`{"title":"Second contract issue with a long enough title","type":"feature","priority":"P1"}`,
	); status != http.StatusCreated && status != http.StatusOK {
		t.Fatalf("create second issue status = %d", status)
	}
	second := otherIssue(t, front, first)

	var created struct {
		Data struct {
			Board struct {
				ID string `json:"id"`
			} `json:"board"`
		} `json:"data"`
	}
	if status := postJSON(t, front+"/v1/boards",
		`{"name":"Contract board","query":"type = feature"}`, &created,
	); status != http.StatusCreated {
		t.Fatalf("create board status = %d, want 201", status)
	}
	board := created.Data.Board.ID
	if board == "" {
		t.Fatal("created board has no id — POST /v1/boards nests it under `board`")
	}

	position := func(issue string, slot int) {
		t.Helper()
		if status := post(t, front+"/v1/boards/"+board+"/issues",
			`{"issue_id":"`+issue+`","position":`+strconv.Itoa(slot)+`}`); status != http.StatusOK {
			t.Fatalf("position %s at slot %d: status = %d, want 200", issue, slot, status)
		}
	}

	// Pin the second issue first, then push the first issue in front of it.
	// Both calls use slot 1, which is what makes the slot semantics visible:
	// the value is not an index into anything the caller rendered.
	position(second, 1)
	position(first, 1)

	if got := boardCardIDs(t, front, board); !slices.Equal(got, []string{first, second}) {
		t.Fatalf("board order = %v, want %v — slot 1 must place a card at the front",
			got, []string{first, second})
	}

	// Exactly what the Move-down button sends for the card at index 0 of a
	// two-card block: gap = index + 2, so slot 3. Slot 2 would be the no-op.
	position(first, 3)

	if got := boardCardIDs(t, front, board); !slices.Equal(got, []string{second, first}) {
		t.Fatalf("board order = %v, want %v — moving a card down by one is slot "+
			"index + 3, because td counts the rows including the card being moved",
			got, []string{second, first})
	}

	// The append leg. A third card is pinned at the front and then sent to
	// slot pinned + 1, so the assertion is a move from first place to last —
	// not a card that would have sorted last anyway.
	if status := post(t, front+"/v1/issues",
		`{"title":"Third contract issue with a long enough title","type":"feature","priority":"P1"}`,
	); status != http.StatusCreated && status != http.StatusOK {
		t.Fatalf("create third issue status = %d", status)
	}
	third := ""
	for _, id := range boardIssueIDs(t, front) {
		if id != first && id != second {
			third = id
		}
	}
	if third == "" {
		t.Fatal("no third issue in the project")
	}

	position(third, 1)
	if got := boardCardIDs(t, front, board); !slices.Equal(got, []string{third, second, first}) {
		t.Fatalf("board order = %v, want %v", got, []string{third, second, first})
	}

	position(third, 4)
	if got := boardCardIDs(t, front, board); !slices.Equal(got, []string{second, first, third}) {
		t.Fatalf("board order = %v, want %v — a slot one past the positioned cards "+
			"must append", got, []string{second, first, third})
	}
}

// boardIssueIDs lists every issue in the project.
func boardIssueIDs(t *testing.T, front string) []string {
	t.Helper()
	var body struct {
		Data struct {
			Issues []struct {
				ID string `json:"id"`
			} `json:"issues"`
		} `json:"data"`
	}
	getJSON(t, front+"/v1/issues?limit=50", &body)
	ids := make([]string, 0, len(body.Data.Issues))
	for _, i := range body.Data.Issues {
		ids = append(ids, i.ID)
	}
	return ids
}

// TestCreateFieldsContract pins that one POST /v1/issues carries every field
// the create form offers, so the GUI never needs a follow-up PATCH — the
// frontend suite runs against msw and can only prove what we told it to.
//
// It also pins the negative that scopes the form: depends_on and blocks are
// td create flags that this endpoint ignores, which is why dependencies are
// added from the detail view instead.
func TestCreateFieldsContract(t *testing.T) {
	front, seeded := newProject(t)

	// An epic to hang the new issue off. Created first because parent_id has
	// to name an issue that already exists. The project holds exactly two
	// issues at this point — the one newProject seeded and this epic — so
	// otherIssue returns the epic.
	if status := post(t, front+"/v1/issues",
		`{"title":"Contract epic with a sufficiently long title","type":"epic"}`,
	); status != http.StatusCreated && status != http.StatusOK {
		t.Fatalf("create parent epic: status = %d", status)
	}
	parent := otherIssue(t, front, seeded)

	var created struct {
		Data struct {
			Issue map[string]any `json:"issue"`
		} `json:"data"`
	}
	body := `{"title":"Contract issue carrying every create field",` +
		`"description":"a description","acceptance":"it works",` +
		`"type":"feature","priority":"P1","points":5,"sprint":"sprint-1",` +
		`"labels":["alpha","beta"],"parent_id":"` + parent + `",` +
		`"due_date":"2026-09-01","defer_until":"2026-08-20","minor":true,` +
		`"depends_on":"` + parent + `","blocks":"` + parent + `"}`

	if status := postJSON(t, front+"/v1/issues", body, &created); status != http.StatusCreated &&
		status != http.StatusOK {
		t.Fatalf("create with every field: status = %d — if td started rejecting "+
			"one of these the create form sends a body it cannot accept", status)
	}

	issue := created.Data.Issue
	for field, want := range map[string]any{
		"title":       "Contract issue carrying every create field",
		"description": "a description",
		"acceptance":  "it works",
		"type":        "feature",
		"priority":    "P1",
		"points":      float64(5),
		"sprint":      "sprint-1",
		"parent_id":   parent,
		"due_date":    "2026-09-01",
		"defer_until": "2026-08-20",
		"minor":       true,
	} {
		if got := issue[field]; got != want {
			t.Errorf("%s = %v after create, want %v — a field the form sends in "+
				"the create body did not land, so it would need a PATCH", field, got, want)
		}
	}

	labels, _ := issue["labels"].([]any)
	if len(labels) != 2 || labels[0] != "alpha" || labels[1] != "beta" {
		t.Errorf("labels = %v after create, want [alpha beta]", issue["labels"])
	}

	// The scope decision, as an executable fact: if this ever starts failing,
	// dependencies at creation become worth revisiting.
	//
	// Read back through the detail endpoint rather than off the create
	// response: the create response is not required to carry `dependencies` or
	// `blocked_by` at all, and an absent field would make this assertion pass
	// without ever having looked at anything.
	id, ok := issue["id"].(string)
	if !ok {
		t.Fatalf("create response carried no id: %v", issue)
	}
	var detail struct {
		Data struct {
			Dependencies []any `json:"dependencies"`
			BlockedBy    []any `json:"blocked_by"`
		} `json:"data"`
	}
	getJSON(t, front+"/v1/issues/"+id, &detail)
	if deps := detail.Data.Dependencies; len(deps) > 0 {
		t.Errorf("dependencies = %v after create — td now honours depends_on on "+
			"POST /v1/issues, so the create form could offer it", deps)
	}
	if blocked := detail.Data.BlockedBy; len(blocked) > 0 {
		t.Errorf("blocked_by = %v after create — td now honours blocks on "+
			"POST /v1/issues, so the create form could offer it", blocked)
	}
}

// newQueryHandler seeds a throwaway project and fronts it with the real
// tdquery handler. No `td serve` here: a query is a subprocess precisely
// because td serve has no route for one.
func newQueryHandler(t *testing.T) (http.Handler, string) {
	t.Helper()

	td, err := tdbin.Locate("")
	if err != nil {
		t.Skipf("td not available: %v", err)
	}

	dir := t.TempDir()
	run := func(args ...string) string {
		t.Helper()
		cmd := exec.Command(td, args...)
		cmd.Dir = dir
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("td %v failed: %v\n%s", args, err, out)
		}
		return string(out)
	}
	run("init")
	run("create", "A bug that is critical enough to be found", "--type", "bug", "--priority", "P0")
	run("create", "A chore that no query in here asks for", "--type", "chore", "--priority", "P3")

	return tdquery.Handler(td, dir), dir
}

func queryEnvelope(t *testing.T, h http.Handler, q string) (int, queryBody) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/gui/query?"+url.Values{"q": {q}}.Encode(), nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	var body queryBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return rec.Code, body
}

type queryBody struct {
	OK   bool `json:"ok"`
	Data struct {
		IDs []string `json:"ids"`
	} `json:"data"`
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// TestQueryContract pins that a real TDQ expression narrows the result the
// way `td query` does, which is the whole point of the route: /v1/issues
// cannot express it.
func TestQueryContract(t *testing.T) {
	h, _ := newQueryHandler(t)

	status, body := queryEnvelope(t, h, "type = bug AND priority <= P1")

	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if !body.OK {
		t.Fatalf("ok = false: %s", body.Error.Message)
	}
	if len(body.Data.IDs) != 1 {
		t.Fatalf("ids = %v, want exactly the one P0 bug", body.Data.IDs)
	}
}

// TestQueryNoMatchContract pins the sentence td prints on stdout, exiting 0,
// when nothing matches. Read as an id it would surface as a phantom row.
func TestQueryNoMatchContract(t *testing.T) {
	h, _ := newQueryHandler(t)

	status, body := queryEnvelope(t, h, "title ~ zzzznothingmatchesthis")

	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if len(body.Data.IDs) != 0 {
		t.Errorf("ids = %v, want none", body.Data.IDs)
	}
}

// TestQueryErrorContract pins td's real wording for a broken query. The unit
// tests use a stub, so without this nothing proves the --json re-run still
// finds a message in the shape td actually emits.
func TestQueryErrorContract(t *testing.T) {
	h, _ := newQueryHandler(t)

	status, body := queryEnvelope(t, h, "status =")

	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (message %q)", status, body.Error.Message)
	}
	if body.OK {
		t.Fatal("ok = true, want false")
	}
	if !strings.Contains(body.Error.Message, "parse error") {
		t.Errorf("message = %q, want td's own parse error", body.Error.Message)
	}
	if strings.Contains(body.Error.Message, "\x1b") {
		t.Errorf("message = %q, want no ANSI escapes", body.Error.Message)
	}
	if strings.Contains(body.Error.Message, "Usage:") {
		t.Errorf("message = %q, want no usage block", body.Error.Message)
	}
}

// TestQueryFlagLikeContract proves the -- separator does its job against the
// real flag parser: without it td reads this query as its own --help, prints
// the help text on stdout and exits 0, and every line of it comes back as an
// id.
func TestQueryFlagLikeContract(t *testing.T) {
	h, _ := newQueryHandler(t)

	_, body := queryEnvelope(t, h, "--help")

	for _, id := range body.Data.IDs {
		if !strings.HasPrefix(id, "td-") {
			t.Fatalf("ids = %v, want only issue ids — td parsed the query as a flag", body.Data.IDs)
		}
	}
}
