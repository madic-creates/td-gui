# Issue relations, review state and metadata — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render dependencies, dependents, epic children, review state, session attribution and issue metadata on the detail view, resolving referenced issues against a single cached list fetch.

**Architecture:** One unfiltered `GET /v1/issues?limit=1000` is held as a `Map<id, Issue>`. Dependency rows and epic children resolve against it in memory; an unresolved reference degrades to the bare id it already showed. Metadata, attribution and review state move into a side column that stacks below the content on narrow viewports.

**Tech Stack:** React 19, TypeScript, react-query v5, react-router, Tailwind v4, vitest + @testing-library/react + msw. Go standard library for the contract tests.

Spec: `docs/superpowers/specs/2026-08-15-issue-relations-and-metadata-design.md`

## Global Constraints

- English only — UI strings, comments, commit messages. No i18n layer. (CLAUDE.md)
- Error text from `td serve` is displayed verbatim, never rewritten.
- No hardcoded field limits or client-side validation bounds. The server validates.
- The frontend never invents data: an absent field means unknown, per the `available_transitions` precedent.
- Transitions go through td's own endpoints, never a raw status PATCH.
- The Go server uses the standard library only.
- Commits are Conventional Commits with a package scope: `feat(web):`, `fix(web):`, `test:`, `docs:`, `refactor(web):`.
- Frontend commands run from `web/`. Use `npm test -- --run`, never bare `npm test`.
- `test/contract` skips itself when `td` is not on PATH. Check for `--- SKIP` before trusting a green contract run.

## File Structure

| File | Responsibility |
| --- | --- |
| `test/contract/contract_test.go` (modify) | Pin the dependency direction and `active_review` presence against real td |
| `web/src/api/types.ts` (modify) | `ActiveReview`, `Review`, optional fields on `IssueDetail` |
| `web/src/api/queries.ts` (modify) | `FETCH_LIMIT` moves here; `useIssue` requests `?with=reviews` |
| `web/src/features/issues/IssueList.tsx` (modify) | Imports `FETCH_LIMIT` instead of declaring it |
| `web/src/features/issues/issueIndex.ts` (create) | Pure resolution: index, resolve, children, resolved-blocker test |
| `web/src/features/issues/useIssueIndex.ts` (create) | The hook wrapping the list query into a `Map` |
| `web/src/features/issues/RelatedIssues.tsx` (create) | One titled group of references to other issues |
| `web/src/features/issues/DependencyPanel.tsx` (modify) | Resolved rows, active/resolved split, keeps add and remove |
| `web/src/features/issues/MetaPanel.tsx` (create) | Metadata and session attribution, present fields only |
| `web/src/features/issues/ReviewPanel.tsx` (create) | `active_review` plus collapsible history |
| `web/src/features/issues/IssueDetail.tsx` (modify) | Two-column layout, wires the panels |

---

### Task 1: Pin the two API facts this design rests on

The design resolves the wrong end of a dependency row if `blocked_by` is misread, and renders an empty review block if `active_review` is assumed always present. Both were probed on td v0.57.0; pin them before any code depends on them.

**Files:**
- Modify: `test/contract/contract_test.go` (append before the final `jsonBody` helper)

**Interfaces:**
- Consumes: `newProject(t) (frontURL, issueID string)`, `getJSON(t, url, into)`, `jsonBody(s string)` — all already in the file.
- Produces: `post(t, url, body) int` and `otherIssue(t, front, notID) string`, used only within this file.

- [ ] **Step 1: Write the failing tests**

Append to `test/contract/contract_test.go`, above the existing `func jsonBody`:

```go
// post sends a JSON body and returns the status code, for the calls whose
// response shape does not matter to the assertion.
func post(t *testing.T, url, body string) int {
	t.Helper()
	resp, err := http.Post(url, "application/json", jsonBody(body))
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
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

	var before struct {
		Data map[string]json.RawMessage `json:"data"`
	}
	getJSON(t, front+"/v1/issues/"+id, &before)
	if _, present := before.Data["active_review"]; present {
		t.Errorf("active_review is present before any review: %s", before.Data["active_review"])
	}

	if code := post(t, front+"/v1/issues/"+id+"/start", `{}`); code != http.StatusOK {
		t.Fatalf("start: status = %d", code)
	}
	if code := post(t, front+"/v1/issues/"+id+"/review", `{}`); code != http.StatusOK {
		t.Fatalf("review: status = %d", code)
	}
	if code := post(t, front+"/v1/issues/"+id+"/reviews",
		`{"decision":"approved","summary":"pinning the review shape"}`); code != http.StatusCreated && code != http.StatusOK {
		t.Fatalf("record review: status = %d", code)
	}

	var after struct {
		Data struct {
			ActiveReview *struct {
				ID              string `json:"id"`
				Decision        string `json:"decision"`
				ReviewerSession string `json:"reviewer_session"`
				Summary         string `json:"summary"`
				CreatedAt       string `json:"created_at"`
			} `json:"active_review"`
			Reviews []map[string]any `json:"reviews"`
		} `json:"data"`
	}
	getJSON(t, front+"/v1/issues/"+id, &after)
	if after.Data.ActiveReview == nil {
		t.Fatal("active_review is absent after a review was recorded")
	}
	if after.Data.ActiveReview.Decision != "approved" {
		t.Errorf("decision = %q, want approved", after.Data.ActiveReview.Decision)
	}
	for _, field := range []string{
		after.Data.ActiveReview.ID,
		after.Data.ActiveReview.ReviewerSession,
		after.Data.ActiveReview.Summary,
		after.Data.ActiveReview.CreatedAt,
	} {
		if field == "" {
			t.Errorf("active_review has an empty field: %+v", after.Data.ActiveReview)
		}
	}

	// History arrives only when asked for.
	getJSON(t, front+"/v1/issues/"+id+"?with=reviews", &after)
	if len(after.Data.Reviews) == 0 {
		t.Error("reviews is empty under ?with=reviews, want the recorded review")
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./test/contract/ -run 'TestDependencyDirectionContract|TestActiveReviewContract' -v`
Expected: compile error — `post` and `otherIssue` are new, so if they were mistyped this is where it shows. Once it compiles, both tests must PASS immediately: they describe td's existing behaviour, not behaviour to be built. A FAIL here means the probe finding is wrong and the design needs revisiting before any UI work.

- [ ] **Step 3: Confirm the suite did not skip**

Run: `go test ./test/contract/ -v 2>&1 | grep -E '^--- (PASS|FAIL|SKIP)'`
Expected: 12 lines, all `--- PASS`, no `--- SKIP`. A SKIP means `td` is not on PATH and nothing was actually verified.

- [ ] **Step 4: Commit**

```bash
git add test/contract/contract_test.go
git commit -m "test(contract): pin the dependency direction and active_review presence"
```

---

### Task 2: Type the review shapes and widen the detail query

**Files:**
- Modify: `web/src/api/types.ts`
- Modify: `web/src/api/queries.ts`
- Modify: `web/src/features/issues/IssueList.tsx:17-24`
- Test: `web/src/features/issues/IssueDetail.test.tsx`

**Interfaces:**
- Produces: `FETCH_LIMIT: number` exported from `api/queries.ts`; `ActiveReview` and `Review` interfaces; `IssueDetail.active_review?: ActiveReview` and `IssueDetail.reviews?: Review[]`.

- [ ] **Step 1: Write the failing test**

Add to `web/src/features/issues/IssueDetail.test.tsx`, inside the existing `describe('IssueDetail', …)`:

```tsx
  // History is always loaded, so expanding it needs no second request and no
  // second cache entry for the same issue.
  it('requests the review history with the issue', async () => {
    let seen: URL | undefined
    server.use(http.get('/v1/issues/td-6a0883', ({ request }) => {
      seen = new URL(request.url)
      return HttpResponse.json({ ok: true, data: detail })
    }))

    renderDetail()
    await screen.findByText('Probe issue for API shape')
    expect(seen?.searchParams.get('with')).toBe('reviews')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `web/`): `npm test -- --run src/features/issues/IssueDetail.test.tsx -t 'review history'`
Expected: FAIL — `expected null to be "reviews"`.

- [ ] **Step 3: Add the types**

Append to `web/src/api/types.ts`:

```ts
/**
 * The review currently standing on an issue. Absent until one is recorded —
 * td does not send the key at all before that, so this is optional on the
 * detail response and a missing value means "never reviewed", not "unknown".
 */
export interface ActiveReview {
  id: string
  decision: string
  reviewer_session: string
  requested_by_session: string
  summary: string
  created_at: string
  self_review: boolean
}

/** One entry of the review history, returned only under `?with=reviews`. */
export interface Review {
  id: string
  issue_id: string
  reviewer_session: string
  decision: string
  summary: string
  requested_by_session: string
  created_at: string
  self_review: boolean
}
```

Extend `IssueDetail` in the same file:

```ts
export interface IssueDetail {
  issue: Issue
  logs: LogEntry[]
  comments: Comment[]
  dependencies: Dependency[]
  blocked_by: Dependency[]
  latest_handoff: Handoff | null
  /** Absent until a review is recorded. */
  active_review?: ActiveReview
  /** Present only under `?with=reviews`. */
  reviews?: Review[]
}
```

- [ ] **Step 4: Move FETCH_LIMIT and widen the query**

In `web/src/api/queries.ts`, add above `issueKeys`:

```ts
/* td validates `limit` as 1-1000 and rejects anything larger, so this is the
   most one request can carry rather than a number we picked. Sorting and
   dependency resolution both need the whole result set, so both callers ask
   for it. */
export const FETCH_LIMIT = 1000
```

Change `useIssue` in the same file:

```ts
export function useIssue(id: string) {
  return useQuery({
    queryKey: issueKeys.detail(id),
    // Review history always rides along: expanding it then needs no second
    // request, no extra loading state, and no second cache entry per issue.
    queryFn: () => apiGet<IssueDetail>(`/v1/issues/${id}?with=reviews`),
    enabled: id !== '',
  })
}
```

In `web/src/features/issues/IssueList.tsx`, delete the local `FETCH_LIMIT` block (the comment and `const FETCH_LIMIT = 1000`) and import it instead:

```tsx
import { useIssues, FETCH_LIMIT, type IssueListParams } from '../../api/queries'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `web/`): `npm test -- --run src/features/issues/IssueDetail.test.tsx src/features/issues/IssueList.test.tsx`
Expected: PASS. The existing IssueList test asserting `limit=1000` must still pass — it proves the move did not change the value.

- [ ] **Step 6: Commit**

```bash
git add web/src/api/types.ts web/src/api/queries.ts web/src/features/issues/IssueList.tsx web/src/features/issues/IssueDetail.test.tsx
git commit -m "feat(web): type the review shapes and load review history with the issue"
```

---

### Task 3: Pure resolution against an issue index

**Files:**
- Create: `web/src/features/issues/issueIndex.ts`
- Test: `web/src/features/issues/issueIndex.test.ts`

**Interfaces:**
- Consumes: `makeIssue(over?: Partial<Issue>): Issue` from `./issue.fixture`.
- Produces: `interface Related { id: string; issue: Issue | null }`, `indexById(issues: Issue[]): Map<string, Issue>`, `resolve(deps: Dependency[], index: Map<string, Issue>, key: 'depends_on_id' | 'issue_id'): Related[]`, `childrenOf(issues: Issue[], parentId: string): Issue[]`, `isResolved(related: Related): boolean`.

- [ ] **Step 1: Write the failing test**

Create `web/src/features/issues/issueIndex.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { childrenOf, indexById, isResolved, resolve } from './issueIndex'
import { makeIssue } from './issue.fixture'
import type { Dependency } from '../../api/types'

const dep = (over: Partial<Dependency> = {}): Dependency => ({
  dep_id: 'dep_1', issue_id: 'td-waits', depends_on_id: 'td-blocks',
  relation_type: 'depends_on', ...over,
})

describe('resolve', () => {
  // The two ends of one row are two different questions. Reading the wrong
  // one renders a panel that looks right and lists the opposite issues.
  it('reads depends_on_id for what the issue waits for', () => {
    const blocker = makeIssue({ id: 'td-blocks', title: 'The blocker' })
    const index = indexById([blocker])

    expect(resolve([dep()], index, 'depends_on_id')).toEqual([
      { id: 'td-blocks', issue: blocker },
    ])
  })

  it('reads issue_id for what waits on the issue', () => {
    const dependent = makeIssue({ id: 'td-waits', title: 'The dependent' })
    const index = indexById([dependent])

    expect(resolve([dep()], index, 'issue_id')).toEqual([
      { id: 'td-waits', issue: dependent },
    ])
  })

  // A capped list and a deleted issue are indistinguishable here, and both
  // mean the same to the reader: the title is unknown. The row survives.
  it('keeps a reference the index does not hold, with a null issue', () => {
    expect(resolve([dep()], indexById([]), 'depends_on_id')).toEqual([
      { id: 'td-blocks', issue: null },
    ])
  })

  it('resolves every row of a mixed batch independently', () => {
    const known = makeIssue({ id: 'td-known' })
    const rows = [
      dep({ dep_id: 'dep_1', depends_on_id: 'td-known' }),
      dep({ dep_id: 'dep_2', depends_on_id: 'td-missing' }),
    ]

    expect(resolve(rows, indexById([known]), 'depends_on_id')).toEqual([
      { id: 'td-known', issue: known },
      { id: 'td-missing', issue: null },
    ])
  })

  it('returns nothing for no rows', () => {
    expect(resolve([], indexById([makeIssue()]), 'depends_on_id')).toEqual([])
  })
})

describe('childrenOf', () => {
  it('selects the issues whose parent is the given id', () => {
    const child = makeIssue({ id: 'td-child', parent_id: 'td-epic' })
    const other = makeIssue({ id: 'td-other', parent_id: 'td-elsewhere' })
    const orphan = makeIssue({ id: 'td-orphan', parent_id: null })

    expect(childrenOf([child, other, orphan], 'td-epic')).toEqual([child])
  })

  it('returns nothing when no issue names that parent', () => {
    expect(childrenOf([makeIssue({ parent_id: null })], 'td-epic')).toEqual([])
  })
})

describe('isResolved', () => {
  it('counts a closed blocker as resolved', () => {
    expect(isResolved({ id: 'td-a', issue: makeIssue({ status: 'closed' }) })).toBe(true)
  })

  it('counts every other status as still blocking', () => {
    expect(isResolved({ id: 'td-a', issue: makeIssue({ status: 'in_review' }) })).toBe(false)
  })

  // Unknown is not the same as done — an unresolved row stays in the active
  // group rather than being quietly filed away as finished.
  it('counts an unresolved reference as still blocking', () => {
    expect(isResolved({ id: 'td-a', issue: null })).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `web/`): `npm test -- --run src/features/issues/issueIndex.test.ts`
Expected: FAIL — `Failed to resolve import "./issueIndex"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/features/issues/issueIndex.ts`:

```ts
import type { Dependency, Issue } from '../../api/types'

/**
 * A reference to another issue, looked up or not. `issue` is null when the
 * index does not hold it: the list fetch was capped, or the issue was deleted.
 * Both mean the title is unknown, and the caller renders the bare id.
 */
export interface Related {
  id: string
  issue: Issue | null
}

export function indexById(issues: Issue[]): Map<string, Issue> {
  return new Map(issues.map(issue => [issue.id, issue]))
}

/**
 * Resolves one end of each dependency row. One row appears on both issues it
 * connects, so which end to read depends on which issue is being viewed:
 * `depends_on_id` is what this issue waits for (td's BLOCKED BY), `issue_id`
 * is what waits on it (td's BLOCKS). Note that the API field named
 * `blocked_by` carries the latter — see the spec.
 */
export function resolve(
  deps: Dependency[],
  index: Map<string, Issue>,
  key: 'depends_on_id' | 'issue_id',
): Related[] {
  return deps.map(dep => ({ id: dep[key], issue: index.get(dep[key]) ?? null }))
}

/** Epic children exist only as `parent_id` on the children; no endpoint lists them. */
export function childrenOf(issues: Issue[], parentId: string): Issue[] {
  return issues.filter(issue => issue.parent_id === parentId)
}

/**
 * A closed blocker no longer blocks. An unresolved reference does not count as
 * resolved: unknown is not done, and filing it under "resolved" would hide a
 * dependency that may well still be open.
 */
export const isResolved = (related: Related): boolean =>
  related.issue?.status === 'closed'
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `web/`): `npm test -- --run src/features/issues/issueIndex.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/issues/issueIndex.ts web/src/features/issues/issueIndex.test.ts
git commit -m "feat(web): resolve issue references against an in-memory index"
```

---

### Task 4: The hook that supplies the index

**Files:**
- Create: `web/src/features/issues/useIssueIndex.ts`
- Test: `web/src/features/issues/useIssueIndex.test.tsx`

**Interfaces:**
- Consumes: `FETCH_LIMIT`, `useIssues` from `../../api/queries`; `indexById` from `./issueIndex`.
- Produces: `useIssueIndex(): { index: Map<string, Issue>; issues: Issue[] }`.

The hook lives under `features/issues`, not in `api/queries.ts`, so the API layer keeps knowing nothing about feature-level resolution.

- [ ] **Step 1: Write the failing test**

Create `web/src/features/issues/useIssueIndex.test.tsx`:

```tsx
import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { useIssueIndex } from './useIssueIndex'
import { makeIssue } from './issue.fixture'
import type { ReactNode } from 'react'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useIssueIndex', () => {
  it('indexes the whole unfiltered list by id', async () => {
    const issues = [makeIssue({ id: 'td-aaa' }), makeIssue({ id: 'td-bbb' })]
    let seen: URL | undefined
    server.use(http.get('/v1/issues', ({ request }) => {
      seen = new URL(request.url)
      return HttpResponse.json({
        ok: true,
        data: { issues, limit: 1000, offset: 0, total: 2, has_more: false },
      })
    }))

    const { result } = renderHook(() => useIssueIndex(), { wrapper })

    await waitFor(() => expect(result.current.index.size).toBe(2))
    expect(result.current.index.get('td-aaa')?.id).toBe('td-aaa')
    expect(result.current.issues).toHaveLength(2)
    expect(seen?.searchParams.get('limit')).toBe('1000')
    // Unfiltered: a status filter would hide referenced issues from the index.
    expect(seen?.searchParams.getAll('status')).toEqual([])
  })

  // The index is enrichment. Callers render bare ids until it lands, so it
  // must report an empty index rather than throw or suspend.
  it('reports an empty index while the list is still loading', () => {
    server.use(http.get('/v1/issues', () => HttpResponse.json({
      ok: true, data: { issues: [], limit: 1000, offset: 0, total: 0, has_more: false },
    })))

    const { result } = renderHook(() => useIssueIndex(), { wrapper })
    expect(result.current.index.size).toBe(0)
    expect(result.current.issues).toEqual([])
  })

  it('reports an empty index when the list request fails', async () => {
    server.use(http.get('/v1/issues', () => HttpResponse.json(
      { ok: false, error: { code: 'internal', message: 'boom' } }, { status: 500 })))

    const { result } = renderHook(() => useIssueIndex(), { wrapper })

    await waitFor(() => expect(result.current.index.size).toBe(0))
    expect(result.current.issues).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `web/`): `npm test -- --run src/features/issues/useIssueIndex.test.tsx`
Expected: FAIL — `Failed to resolve import "./useIssueIndex"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/features/issues/useIssueIndex.ts`:

```ts
import { useMemo } from 'react'
import { FETCH_LIMIT, useIssues } from '../../api/queries'
import { indexById } from './issueIndex'
import type { Issue } from '../../api/types'

/**
 * The whole issue list, by id. Dependencies carry only id triples and epic
 * children are not returned at all, so both are resolved against this.
 *
 * The query is deliberately identical to the one IssueList issues, so it is
 * usually a react-query cache hit rather than a second request. It is also
 * deliberately unfiltered: a status filter on the list would drop referenced
 * issues out of the index and blank their titles.
 *
 * Loading and failure both surface as an empty index. Titles are enrichment,
 * not the detail view's data, so callers fall back to the bare id rather than
 * reporting an error the reader cannot act on.
 */
export function useIssueIndex(): { index: Map<string, Issue>; issues: Issue[] } {
  const { data } = useIssues({ limit: FETCH_LIMIT })
  const issues = data?.issues ?? []
  return useMemo(() => ({ index: indexById(issues), issues }), [data])
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `web/`): `npm test -- --run src/features/issues/useIssueIndex.test.tsx`
Expected: PASS, 3 tests.

If oxlint flags the `useMemo` dependency array for not listing `issues`, add above it:

```ts
  // `issues` is derived from `data` on every render; only the query result
  // should rebuild the map.
  // eslint-disable-next-line react-hooks/exhaustive-deps
```

- [ ] **Step 5: Commit**

```bash
git add web/src/features/issues/useIssueIndex.ts web/src/features/issues/useIssueIndex.test.tsx
git commit -m "feat(web): supply the issue index from the shared list query"
```

---

### Task 5: A group of references to other issues

**Files:**
- Create: `web/src/features/issues/RelatedIssues.tsx`
- Test: `web/src/features/issues/RelatedIssues.test.tsx`

**Interfaces:**
- Consumes: `Related` from `./issueIndex`; `StatusTag` from `../../components/StatusTag`.
- Produces: `<RelatedIssues title={string} items={Related[]} />`, default export.

- [ ] **Step 1: Write the failing test**

Create `web/src/features/issues/RelatedIssues.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import RelatedIssues from './RelatedIssues'
import { makeIssue } from './issue.fixture'

const show = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('RelatedIssues', () => {
  it('lists a resolved reference with its title and status', () => {
    const issue = makeIssue({ id: 'td-aaa', title: 'The blocker', status: 'in_review' })
    show(<RelatedIssues title="Blocked by" items={[{ id: 'td-aaa', issue }]} />)

    expect(screen.getByText('Blocked by (1)')).toBeInTheDocument()
    expect(screen.getByText('The blocker')).toBeInTheDocument()
    expect(screen.getByText('in_review')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'td-aaa' })).toHaveAttribute('href', '/issues/td-aaa')
  })

  // The index may be capped or the issue deleted. The row still links, which
  // is what it did before titles existed — and claims nothing it cannot know.
  it('falls back to the bare id when the reference is unresolved', () => {
    show(<RelatedIssues title="Blocked by" items={[{ id: 'td-zzz', issue: null }]} />)

    expect(screen.getByRole('link', { name: 'td-zzz' })).toHaveAttribute('href', '/issues/td-zzz')
    expect(screen.queryByText('not found')).not.toBeInTheDocument()
    expect(screen.queryByText('unknown')).not.toBeInTheDocument()
  })

  it('renders nothing at all for an empty group', () => {
    const { container } = show(<RelatedIssues title="Blocks" items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('counts the rows in the heading', () => {
    show(<RelatedIssues title="Blocks" items={[
      { id: 'td-aaa', issue: makeIssue({ id: 'td-aaa' }) },
      { id: 'td-bbb', issue: null },
    ]} />)

    expect(screen.getByText('Blocks (2)')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `web/`): `npm test -- --run src/features/issues/RelatedIssues.test.tsx`
Expected: FAIL — `Failed to resolve import "./RelatedIssues"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/features/issues/RelatedIssues.tsx`:

```tsx
import { Link } from 'react-router'
import StatusTag from '../../components/StatusTag'
import type { Related } from './issueIndex'

/**
 * One titled group of references to other issues — what this issue is blocked
 * by, what it blocks, or an epic's tasks.
 *
 * A row whose issue the index does not hold renders as the bare id and
 * nothing else: that is exactly what the panel showed before titles existed,
 * and it beats inventing a "not found" the reader cannot verify.
 */
export default function RelatedIssues({
  title,
  items,
}: {
  title: string
  items: Related[]
}) {
  if (items.length === 0) return null

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[11px] uppercase tracking-widest text-ink-muted">
        {title} ({items.length})
      </h2>
      <ul>
        {items.map(item => (
          <li
            key={item.id}
            className="flex items-center gap-2.5 border-b border-line-subtle py-1.5 last:border-b-0"
          >
            <Link
              to={`/issues/${item.id}`}
              className="shrink-0 font-mono text-[11px] text-accent"
            >
              {item.id}
            </Link>
            {item.issue && (
              <>
                <span className="flex-1 truncate text-ink">{item.issue.title}</span>
                <StatusTag status={item.issue.status} />
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `web/`): `npm test -- --run src/features/issues/RelatedIssues.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/issues/RelatedIssues.tsx web/src/features/issues/RelatedIssues.test.tsx
git commit -m "feat(web): render a group of related issues with title and status"
```

---

### Task 6: Resolved rows and an active/resolved split in DependencyPanel

**Files:**
- Modify: `web/src/features/issues/DependencyPanel.tsx`
- Test: `web/src/features/issues/DependencyPanel.test.tsx`

**Interfaces:**
- Consumes: `useIssueIndex` from `./useIssueIndex`; `resolve`, `isResolved` from `./issueIndex`.
- Produces: the panel keeps its existing props — `<DependencyPanel issueId={string} dependencies={Dependency[]} />`. Do not change the signature; `IssueDetail` already passes exactly this.

The panel keeps its add form, its remove buttons and its `lastAction` error selection unchanged. Only the row rendering and the grouping are new.

- [ ] **Step 1: Give the existing tests an index to resolve against**

`web/src/features/issues/DependencyPanel.test.tsx:11` currently reads
`const server = setupServer()` with no default handlers, and listens with
`onUnhandledRequest: 'error'`. The moment the panel calls `useIssueIndex`,
all seven existing tests fail on an unhandled `GET /v1/issues`. Do this first,
before adding any new test:

```tsx
const server = setupServer(
  // The issue index the panel resolves blocker titles against. Empty by
  // default: the tests that care about resolution override it.
  http.get('/v1/issues', () => HttpResponse.json({
    ok: true, data: { issues: [], limit: 1000, offset: 0, total: 0, has_more: false },
  })),
)
```

Add the fixture import alongside the existing ones:

```tsx
import { makeIssue } from './issue.fixture'
```

- [ ] **Step 2: Write the failing tests**

Add to `web/src/features/issues/DependencyPanel.test.tsx`, inside the existing
`describe('DependencyPanel', …)`. `renderPanel(dependencies)` already exists at
line 21 and needs no change.

```tsx
  it('shows each blocker with its title and status', async () => {
    server.use(http.get('/v1/issues', () => HttpResponse.json({
      ok: true,
      data: {
        issues: [makeIssue({ id: 'td-blk', title: 'The blocker', status: 'in_progress' })],
        limit: 1000, offset: 0, total: 1, has_more: false,
      },
    })))

    renderPanel([{ dep_id: 'dep_1', issue_id: 'td-6a0883', depends_on_id: 'td-blk', relation_type: 'depends_on' }])

    expect(await screen.findByText('The blocker')).toBeInTheDocument()
    expect(screen.getByText('in_progress')).toBeInTheDocument()
  })

  // A finished dependency is not current work. Mixing the two makes a
  // long-closed blocker read as something still in the way.
  it('separates closed blockers from the ones still blocking', async () => {
    server.use(http.get('/v1/issues', () => HttpResponse.json({
      ok: true,
      data: {
        issues: [
          makeIssue({ id: 'td-open', title: 'Still blocking', status: 'open' }),
          makeIssue({ id: 'td-done', title: 'Already done', status: 'closed' }),
        ],
        limit: 1000, offset: 0, total: 2, has_more: false,
      },
    })))

    renderPanel([
      { dep_id: 'dep_1', issue_id: 'td-6a0883', depends_on_id: 'td-open', relation_type: 'depends_on' },
      { dep_id: 'dep_2', issue_id: 'td-6a0883', depends_on_id: 'td-done', relation_type: 'depends_on' },
    ])

    expect(await screen.findByText('Depends on (1)')).toBeInTheDocument()
    expect(screen.getByText('Resolved (1)')).toBeInTheDocument()
  })

  it('keeps a blocker the index does not hold in the active group', async () => {
    server.use(http.get('/v1/issues', () => HttpResponse.json({
      ok: true, data: { issues: [], limit: 1000, offset: 0, total: 0, has_more: false },
    })))

    renderPanel([{ dep_id: 'dep_1', issue_id: 'td-6a0883', depends_on_id: 'td-gone', relation_type: 'depends_on' }])

    expect(await screen.findByText('Depends on (1)')).toBeInTheDocument()
    expect(screen.queryByText('Resolved (1)')).not.toBeInTheDocument()
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run (from `web/`): `npm test -- --run src/features/issues/DependencyPanel.test.tsx`
Expected: the three new tests FAIL — the titles do not render and `Resolved (1)` is absent. The seven existing tests must still PASS; if any of them errors on an unhandled request, Step 1 was skipped.

- [ ] **Step 4: Change the row rendering and grouping**

In `web/src/features/issues/DependencyPanel.tsx`, add the imports:

```tsx
import { useIssueIndex } from './useIssueIndex'
import { isResolved, resolve, type Related } from './issueIndex'
import StatusTag from '../../components/StatusTag'
```

Inside the component, above the `return`, add:

```tsx
  // Dependencies carry only id triples; titles come from the shared index.
  const { index } = useIssueIndex()
  const related = resolve(dependencies, index, 'depends_on_id')
  const active = related.filter(item => !isResolved(item))
  const resolved = related.filter(isResolved)
```

Replace the heading and the single `<ul>` with a helper rendered twice. Add this component at the bottom of the same file:

```tsx
/**
 * One group of blockers. The remove control stays on every row, resolved
 * included: a dependency on a closed issue is still a dependency, and taking
 * it off is exactly what a reader is likely to want here.
 */
function Group({
  title,
  items,
  onRemove,
  disabled,
  depIdFor,
}: {
  title: string
  items: Related[]
  onRemove: (depId: string) => void
  disabled: boolean
  depIdFor: (id: string) => string
}) {
  if (items.length === 0) return null
  return (
    <>
      <h2 className="mb-2 text-[11px] uppercase tracking-widest text-ink-muted">
        {title} ({items.length})
      </h2>
      <ul className="mb-2">
        {items.map(item => (
          <li
            key={item.id}
            className="flex items-center gap-2.5 border-b border-line-subtle py-1.5 last:border-b-0"
          >
            <Link to={`/issues/${item.id}`} className="shrink-0 font-mono text-[11px] text-accent">
              {item.id}
            </Link>
            {item.issue && (
              <>
                <span className="flex-1 truncate text-ink">{item.issue.title}</span>
                <StatusTag status={item.issue.status} />
              </>
            )}
            <ConfirmButton
              label="Remove"
              question="Remove this dependency?"
              disabled={disabled}
              onConfirm={() => onRemove(depIdFor(item.id))}
            />
          </li>
        ))}
      </ul>
    </>
  )
}
```

In the component body, build the id lookup and render both groups where the old heading and list were:

```tsx
  const depIdFor = (id: string) =>
    dependencies.find(d => d.depends_on_id === id)?.dep_id ?? ''
```

```tsx
      <Group
        title="Depends on"
        items={active}
        disabled={remove.isPending}
        depIdFor={depIdFor}
        onRemove={depId => { setLastAction('remove'); remove.mutate(depId) }}
      />
      <Group
        title="Resolved"
        items={resolved}
        disabled={remove.isPending}
        depIdFor={depIdFor}
        onRemove={depId => { setLastAction('remove'); remove.mutate(depId) }}
      />
```

Keep the existing `<form>` for adding and the existing error block below, unchanged. Delete the old `Depends on ({dependencies.length})` heading and its `<ul>`.

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `web/`): `npm test -- --run src/features/issues/DependencyPanel.test.tsx`
Expected: PASS, 10 tests — the three new ones and every existing one, including the add/remove and stale-error tests.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/issues/DependencyPanel.tsx web/src/features/issues/DependencyPanel.test.tsx
git commit -m "feat(web): show blocker titles and split resolved dependencies"
```

---

### Task 7: The metadata and attribution panel

**Files:**
- Create: `web/src/features/issues/MetaPanel.tsx`
- Test: `web/src/features/issues/MetaPanel.test.tsx`

**Interfaces:**
- Consumes: `relativeTime`, `shortSession` from `../../lib/format`; `Issue` from `../../api/types`.
- Produces: `<MetaPanel issue={Issue} />`, default export.

- [ ] **Step 1: Write the failing test**

Create `web/src/features/issues/MetaPanel.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import MetaPanel from './MetaPanel'
import { makeIssue } from './issue.fixture'

const show = (issue = makeIssue()) =>
  render(<MemoryRouter><MetaPanel issue={issue} /></MemoryRouter>)

describe('MetaPanel', () => {
  it('shows the metadata fields that are set', () => {
    show(makeIssue({
      points: 3, labels: ['ui', 'web'], sprint: 'S12',
      due_date: '2026-08-20', defer_until: '2026-08-18', defer_count: 2,
      minor: true, created_branch: 'feat/thing',
    }))

    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('ui, web')).toBeInTheDocument()
    expect(screen.getByText('S12')).toBeInTheDocument()
    expect(screen.getByText('2026-08-20')).toBeInTheDocument()
    expect(screen.getByText('2026-08-18')).toBeInTheDocument()
    expect(screen.getByText('feat/thing')).toBeInTheDocument()
  })

  // No placeholder rows: an unset field is absent, not an em-dash. A row that
  // says nothing still costs the reader a line to scan.
  it('omits every field the issue does not set', () => {
    show(makeIssue({
      points: 0, labels: [], sprint: '', due_date: null,
      defer_until: null, defer_count: 0, minor: false, created_branch: null,
      parent_id: null,
    }))

    for (const label of ['Points', 'Labels', 'Sprint', 'Due', 'Deferred', 'Branch', 'Parent', 'Minor']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
  })

  it('links the parent issue', () => {
    show(makeIssue({ parent_id: 'td-epic00' }))
    expect(screen.getByRole('link', { name: 'td-epic00' })).toHaveAttribute('href', '/issues/td-epic00')
  })

  it('shows the sessions that touched the issue, shortened', () => {
    show(makeIssue({
      implementer_session: 'ses_582415',
      reviewer_session: 'ses_a2b123',
      creator_session: 'ses_d87edf',
      closed_by_session: null,
    }))

    expect(screen.getByText('5824')).toBeInTheDocument()
    expect(screen.getByText('a2b1')).toBeInTheDocument()
    expect(screen.getByText('d87e')).toBeInTheDocument()
    expect(screen.queryByText('Closed by')).not.toBeInTheDocument()
  })

  it('shows the timestamps that are set', () => {
    show(makeIssue({
      created_at: '2026-08-14T15:01:46+02:00',
      updated_at: '2026-08-14T15:01:46+02:00',
      reviewed_at: null,
      closed_at: null,
    }))

    expect(screen.getByText('Created')).toBeInTheDocument()
    expect(screen.getByText('Updated')).toBeInTheDocument()
    expect(screen.queryByText('Reviewed')).not.toBeInTheDocument()
    expect(screen.queryByText('Closed')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `web/`): `npm test -- --run src/features/issues/MetaPanel.test.tsx`
Expected: FAIL — `Failed to resolve import "./MetaPanel"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/features/issues/MetaPanel.tsx`:

```tsx
import { Link, type To } from 'react-router'
import { relativeTime, shortSession } from '../../lib/format'
import type { Issue } from '../../api/types'

/**
 * One label/value line. Rendering is the caller's decision: `Row` is only
 * reached for values that exist, so there is no "absent" state to style.
 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="w-[68px] shrink-0 text-[11px] uppercase tracking-widest text-ink-faint">
        {label}
      </span>
      <span className="flex-1 break-words text-[11px] text-ink">{children}</span>
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line-subtle py-3 last:border-b-0">
      <h2 className="mb-1.5 text-[11px] uppercase tracking-widest text-ink-muted">{title}</h2>
      {children}
    </section>
  )
}

const linkTo = (id: string): To => `/issues/${id}`

/**
 * The facts about an issue that would interrupt the reading flow if they sat
 * between the description and the activity log.
 *
 * Every row is conditional. An unset field renders nothing at all rather than
 * a placeholder: td distinguishes "no sprint" from "sprint unknown" only by
 * absence, and a dash in the value column claims more than we know.
 */
export default function MetaPanel({ issue }: { issue: Issue }) {
  return (
    <div className="rounded-md border border-line bg-surface-raised px-3">
      <Block title="Metadata">
        {issue.points > 0 && <Row label="Points">{issue.points}</Row>}
        {issue.labels.length > 0 && <Row label="Labels">{issue.labels.join(', ')}</Row>}
        {issue.sprint && <Row label="Sprint">{issue.sprint}</Row>}
        {issue.parent_id && (
          <Row label="Parent">
            <Link to={linkTo(issue.parent_id)} className="font-mono text-accent">
              {issue.parent_id}
            </Link>
          </Row>
        )}
        {issue.due_date && <Row label="Due">{issue.due_date}</Row>}
        {issue.defer_until && <Row label="Deferred">{issue.defer_until}</Row>}
        {issue.defer_count > 0 && <Row label="Defers">{issue.defer_count}</Row>}
        {issue.minor && <Row label="Minor">self-reviewable</Row>}
        {issue.created_branch && (
          <Row label="Branch">
            <span className="font-mono">{issue.created_branch}</span>
          </Row>
        )}
      </Block>

      <Block title="Sessions">
        {issue.implementer_session && (
          <Row label="Impl"><span className="font-mono">{shortSession(issue.implementer_session)}</span></Row>
        )}
        {issue.reviewer_session && (
          <Row label="Reviewer"><span className="font-mono">{shortSession(issue.reviewer_session)}</span></Row>
        )}
        {issue.creator_session && (
          <Row label="Creator"><span className="font-mono">{shortSession(issue.creator_session)}</span></Row>
        )}
        {issue.closed_by_session && (
          <Row label="Closed by"><span className="font-mono">{shortSession(issue.closed_by_session)}</span></Row>
        )}
      </Block>

      <Block title="Timeline">
        <Row label="Created">{relativeTime(issue.created_at)}</Row>
        <Row label="Updated">{relativeTime(issue.updated_at)}</Row>
        {issue.reviewed_at && <Row label="Reviewed">{relativeTime(issue.reviewed_at)}</Row>}
        {issue.closed_at && <Row label="Closed">{relativeTime(issue.closed_at)}</Row>}
      </Block>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `web/`): `npm test -- --run src/features/issues/MetaPanel.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/issues/MetaPanel.tsx web/src/features/issues/MetaPanel.test.tsx
git commit -m "feat(web): show issue metadata and session attribution"
```

---

### Task 8: The review panel

**Files:**
- Create: `web/src/features/issues/ReviewPanel.tsx`
- Test: `web/src/features/issues/ReviewPanel.test.tsx`

**Interfaces:**
- Consumes: `ActiveReview`, `Review` from `../../api/types`; `relativeTime`, `shortSession` from `../../lib/format`.
- Produces: `<ReviewPanel active={ActiveReview | undefined} history={Review[] | undefined} />`, default export.

- [ ] **Step 1: Write the failing test**

Create `web/src/features/issues/ReviewPanel.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReviewPanel from './ReviewPanel'
import type { ActiveReview, Review } from '../../api/types'

const active: ActiveReview = {
  id: 'rv-3aee1321', decision: 'approved', reviewer_session: 'ses_a2b123',
  requested_by_session: 'ses_582415', summary: 'Read it end to end',
  created_at: '2026-08-14T15:01:46+02:00', self_review: false,
}

const older = (over: Partial<Review> = {}): Review => ({
  id: 'rv-0000001', issue_id: 'td-6a0883', reviewer_session: 'ses_6075f2',
  decision: 'rejected', summary: 'Missing error handling',
  requested_by_session: 'ses_582415', created_at: '2026-08-13T15:01:46+02:00',
  self_review: false, ...over,
})

describe('ReviewPanel', () => {
  it('shows the standing review with its decision, reviewer and summary', () => {
    render(<ReviewPanel active={active} history={[]} />)

    expect(screen.getByText('approved')).toBeInTheDocument()
    expect(screen.getByText('a2b1')).toBeInTheDocument()
    expect(screen.getByText('Read it end to end')).toBeInTheDocument()
  })

  // td sends no active_review at all before the first one. An empty heading
  // would read as "reviewed, details missing".
  it('renders nothing when the issue has never been reviewed', () => {
    const { container } = render(<ReviewPanel active={undefined} history={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('marks earlier reviews as superseded behind a disclosure', async () => {
    render(<ReviewPanel active={active} history={[older({ id: 'rv-1' }), older({ id: 'rv-2' })]} />)

    // The history is loaded with the issue, so opening it fetches nothing.
    await userEvent.click(screen.getByText('2 earlier reviews'))
    expect(screen.getAllByText('(superseded)')).toHaveLength(2)
    expect(screen.getAllByText('Missing error handling')).toHaveLength(2)
  })

  it('offers no disclosure when the standing review is the only one', () => {
    render(<ReviewPanel active={active} history={[{ ...older(), id: active.id }]} />)
    expect(screen.queryByText(/earlier review/)).not.toBeInTheDocument()
  })

  it('says so when the reviewer reviewed their own work', () => {
    render(<ReviewPanel active={{ ...active, self_review: true }} history={[]} />)
    expect(screen.getByText('self-reviewed')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `web/`): `npm test -- --run src/features/issues/ReviewPanel.test.tsx`
Expected: FAIL — `Failed to resolve import "./ReviewPanel"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/features/issues/ReviewPanel.tsx`:

```tsx
import { relativeTime, shortSession } from '../../lib/format'
import type { ActiveReview, Review } from '../../api/types'

const decisionTone: Record<string, string> = {
  approved: 'text-success',
  rejected: 'text-danger',
}

/**
 * The review standing on the issue, and what it replaced.
 *
 * `active` is absent until a review is recorded — td omits the key entirely —
 * so the whole panel disappears rather than showing an empty heading, which
 * would read as "reviewed, details missing".
 *
 * The history arrives with the issue under `?with=reviews`, so the disclosure
 * opens without a request. Entries other than the standing one are marked
 * superseded, matching what td's own modal shows.
 */
export default function ReviewPanel({
  active,
  history,
}: {
  active?: ActiveReview
  history?: Review[]
}) {
  if (!active) return null

  const earlier = (history ?? []).filter(review => review.id !== active.id)

  return (
    <section className="mt-3 rounded-md border border-line bg-surface-raised px-3 py-3">
      <h2 className="mb-1.5 text-[11px] uppercase tracking-widest text-ink-muted">Review</h2>

      <div className="flex items-baseline gap-2 text-[11px]">
        <span className={decisionTone[active.decision] ?? 'text-ink'}>{active.decision}</span>
        <span className="font-mono text-ink-muted">{shortSession(active.reviewer_session)}</span>
        <span className="ml-auto text-ink-faint">{relativeTime(active.created_at)}</span>
      </div>
      {active.self_review && (
        <p className="mt-1 text-[11px] text-st-review">self-reviewed</p>
      )}
      {active.summary && (
        <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed text-ink">
          {active.summary}
        </p>
      )}

      {earlier.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-ink-muted">
            {earlier.length} earlier review{earlier.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-1.5">
            {earlier.map(review => (
              <li key={review.id} className="border-t border-line-subtle py-1.5">
                <div className="flex items-baseline gap-2 text-[11px]">
                  <span className={decisionTone[review.decision] ?? 'text-ink'}>
                    {review.decision}
                  </span>
                  <span className="text-ink-faint">(superseded)</span>
                  <span className="font-mono text-ink-muted">
                    {shortSession(review.reviewer_session)}
                  </span>
                  <span className="ml-auto text-ink-faint">{relativeTime(review.created_at)}</span>
                </div>
                {review.summary && (
                  <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-ink-muted">
                    {review.summary}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `web/`): `npm test -- --run src/features/issues/ReviewPanel.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/issues/ReviewPanel.tsx web/src/features/issues/ReviewPanel.test.tsx
git commit -m "feat(web): show the standing review and its superseded history"
```

---

### Task 9: Wire the panels into a two-column detail view

**Files:**
- Modify: `web/src/features/issues/IssueDetail.tsx`
- Test: `web/src/features/issues/IssueDetail.test.tsx`

**Interfaces:**
- Consumes: `useIssueIndex`, `resolve`, `childrenOf`, `RelatedIssues`, `MetaPanel`, `ReviewPanel` — all as produced by Tasks 4 through 8.

- [ ] **Step 1: Write the failing test**

Add to `web/src/features/issues/IssueDetail.test.tsx`, inside the existing `describe('IssueDetail', …)`:

```tsx
  // `blocked_by` holds what waits on this issue, despite its name. Resolving
  // the wrong end lists the opposite issues and still looks plausible.
  it('lists what the issue blocks from blocked_by', async () => {
    server.use(
      http.get('/v1/issues/td-6a0883', () => HttpResponse.json({
        ok: true,
        data: {
          ...detail,
          blocked_by: [{
            dep_id: 'dep_1', issue_id: 'td-waits',
            depends_on_id: 'td-6a0883', relation_type: 'depends_on',
          }],
        },
      })),
      http.get('/v1/issues', () => HttpResponse.json({
        ok: true,
        data: {
          issues: [makeIssue({ id: 'td-waits', title: 'The dependent issue' })],
          limit: 1000, offset: 0, total: 1, has_more: false,
        },
      })),
    )

    renderDetail()
    expect(await screen.findByText('Blocks (1)')).toBeInTheDocument()
    expect(screen.getByText('The dependent issue')).toBeInTheDocument()
  })

  it('lists the children of an epic', async () => {
    const issue = { ...detail.issue, type: 'epic' }
    server.use(
      http.get('/v1/issues/td-6a0883', () =>
        HttpResponse.json({ ok: true, data: { ...detail, issue } })),
      http.get('/v1/issues', () => HttpResponse.json({
        ok: true,
        data: {
          issues: [
            makeIssue({ id: 'td-child0', title: 'A task in the epic', parent_id: 'td-6a0883' }),
            makeIssue({ id: 'td-other0', title: 'Unrelated', parent_id: null }),
          ],
          limit: 1000, offset: 0, total: 2, has_more: false,
        },
      })),
    )

    renderDetail()
    expect(await screen.findByText('Tasks (1)')).toBeInTheDocument()
    expect(screen.getByText('A task in the epic')).toBeInTheDocument()
    expect(screen.queryByText('Unrelated')).not.toBeInTheDocument()
  })

  it('lists no tasks for an issue that is not an epic', async () => {
    server.use(
      http.get('/v1/issues/td-6a0883', () =>
        HttpResponse.json({ ok: true, data: detail })),
      http.get('/v1/issues', () => HttpResponse.json({
        ok: true,
        data: {
          issues: [makeIssue({ id: 'td-child0', parent_id: 'td-6a0883' })],
          limit: 1000, offset: 0, total: 1, has_more: false,
        },
      })),
    )

    renderDetail()
    await screen.findByText('Probe issue for API shape')
    expect(screen.queryByText(/^Tasks/)).not.toBeInTheDocument()
  })

  it('shows the standing review from active_review', async () => {
    server.use(
      http.get('/v1/issues/td-6a0883', () => HttpResponse.json({
        ok: true,
        data: {
          ...detail,
          active_review: {
            id: 'rv-1', decision: 'approved', reviewer_session: 'ses_a2b123',
            requested_by_session: 'ses_582415', summary: 'Looks right',
            created_at: '2026-08-14T15:01:46+02:00', self_review: false,
          },
        },
      })),
      http.get('/v1/issues', () => HttpResponse.json({
        ok: true, data: { issues: [], limit: 1000, offset: 0, total: 0, has_more: false },
      })),
    )

    renderDetail()
    expect(await screen.findByText('Looks right')).toBeInTheDocument()
  })
```

Add the fixture import at the top of the file:

```tsx
import { makeIssue } from './issue.fixture'
```

The file's existing `server` has no `GET /v1/issues` handler and runs with `onUnhandledRequest: 'error'`. Register a default one alongside the existing `/v1/labels` handler so every older test keeps passing once the detail view starts asking for the index:

```tsx
const server = setupServer(
  // The edit form's label autocomplete. Registered once so opening the editor
  // does not trip onUnhandledRequest in every test that clicks Edit.
  http.get('/v1/labels', () =>
    HttpResponse.json({ ok: true, data: { default_workflow: 'standard', labels: [] } })),
  // The issue index the detail view resolves references against. Empty by
  // default: tests that care about resolution override it.
  http.get('/v1/issues', () => HttpResponse.json({
    ok: true, data: { issues: [], limit: 1000, offset: 0, total: 0, has_more: false },
  })),
)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `web/`): `npm test -- --run src/features/issues/IssueDetail.test.tsx`
Expected: FAIL on the four new tests — `Blocks (1)`, `Tasks (1)` and `Looks right` are absent.

- [ ] **Step 3: Wire the panels and the layout**

In `web/src/features/issues/IssueDetail.tsx`, add the imports:

```tsx
import RelatedIssues from './RelatedIssues'
import MetaPanel from './MetaPanel'
import ReviewPanel from './ReviewPanel'
import { useIssueIndex } from './useIssueIndex'
import { childrenOf, resolve } from './issueIndex'
```

Widen the destructure of `data`:

```tsx
  const { issue, logs, comments, dependencies, blocked_by, latest_handoff,
    active_review, reviews } = data
```

Below it, resolve the references:

```tsx
  const { index, issues } = useIssueIndex()
  // `blocked_by` holds the rows where this issue is the one being waited for,
  // so it answers "what does this block" — the opposite of what its name says.
  const blocks = resolve(blocked_by, index, 'issue_id')
  const tasks = issue.type === 'epic'
    ? childrenOf(issues, issue.id).map(child => ({ id: child.id, issue: child }))
    : []
```

Wrap the existing content in a two-column grid. The outer `<div className="px-5 py-4 pb-6">` gains a grid child; everything currently inside it, from the back link down to the comments section, moves into the first column:

```tsx
    <div className="px-5 py-4 pb-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          {/* … the entire existing content, unchanged … */}
        </div>
        <aside>
          <MetaPanel issue={issue} />
          <ReviewPanel active={active_review} history={reviews} />
        </aside>
      </div>
    </div>
```

`minmax(0,1fr)` rather than `1fr` — without it a long unbroken title or branch name makes the content column refuse to shrink and pushes the aside off-screen.

Add the two relation sections in the main column, directly after the existing `<DependencyPanel …/>`:

```tsx
      <RelatedIssues title="Blocks" items={blocks} />
      <RelatedIssues title="Tasks" items={tasks} />
```

`DependencyPanel` keeps rendering what the issue is blocked by, since it also owns the add and remove controls.

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `web/`): `npm test -- --run src/features/issues/IssueDetail.test.tsx`
Expected: PASS, 26 tests — the four new ones plus the 22 the file holds after Task 2.

- [ ] **Step 5: Run the whole suite and the linters**

Run (from `web/`): `npm test -- --run`
Expected: PASS, all files.

Run (from the repo root): `make lint`
Expected: exit 0, `0 issues` from golangci-lint and no oxlint findings.

Run (from `web/`): `npx tsc --noEmit`
Expected: exit 0, no output.

Run (from the repo root): `go test ./test/contract/ -v 2>&1 | grep -E '^--- '`
Expected: all `--- PASS`, no `--- SKIP`.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/issues/IssueDetail.tsx web/src/features/issues/IssueDetail.test.tsx
git commit -m "feat(web): render relations, review state and metadata on the detail view"
```

---

## Acceptance criteria coverage

| Criterion (td-7a8b61) | Tasks |
| --- | --- |
| Dependencies and dependents with title and status, active split from resolved, each linking | 3, 4, 5, 6, 9 |
| Acceptance criteria as their own section when non-empty | already landed in `2866f5b` |
| Session attribution and metadata render when present, absent when null, no placeholder rows | 7 |
| Review state from `active_review`, history behind `?with=reviews` | 2, 8, 9 |
| Epic children listed for issues of type epic | 3, 4, 5, 9 |
| Nothing invented client-side; absent means unknown | 1, 3, 5, 7, 8 |

## Definition of done

- `make test` green from the repo root, with `go test ./test/contract/` showing no `--- SKIP`.
- `npx tsc --noEmit` clean from `web/`.
- Nine commits, one per task, each green on its own.
- `td handoff td-7a8b61` recorded, then `td review td-7a8b61`. The implementing session cannot approve it.
