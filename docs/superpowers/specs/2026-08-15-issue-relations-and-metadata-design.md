# Issue relations, review state and metadata on the detail view

td issue: td-7a8b61 (epic td-5206e8)
Date: 2026-08-15

## Problem

`IssueDetail` destructures `{ issue, logs, comments, dependencies,
latest_handoff }` and renders a fraction of what it holds. Dependencies show as
bare ids, `blocked_by` is fetched and thrown away, and the whole metadata half
of an issue — points, labels, sprint, parent, dates, session attribution,
review state — never reaches the screen. td's own detail modal shows all of it,
so the GUI is strictly worse than `td show` for reading an issue.

Acceptance criteria rendering, one of this issue's six criteria, already landed
separately as `2866f5b`. This spec covers the remaining five.

## What td actually does

Verified against td v0.57.0 by probing a live `td serve`, not read from
documentation. Three findings contradict the issue description and are
load-bearing for the design.

**`blocked_by` means "blocks".** One dependency row appears on both issues, in
different fields. Given A depends on B:

| Field on A                        | Field on B                        |
| --------------------------------- | --------------------------------- |
| `dependencies: [{issue_id: A, depends_on_id: B}]` | `blocked_by: [{issue_id: A, depends_on_id: B}]` |

So `dependencies` on an issue is what it waits for — td's **BLOCKED BY** — and
`blocked_by` is what waits on it, td's **BLOCKS**. The field name states the
opposite of its content. Resolving the wrong end of the triple produces a
panel that looks right and is backwards, which no type checker can catch.

**`active_review` is absent until a review exists.** The issue description
calls it "always present on the single-issue read". It is not: before the first
review the key is missing from the payload entirely, and it appears once a
review is recorded. Its shape:

```json
{ "id": "rv-3aee1321", "decision": "approved", "reviewer_session": "ses_26a332",
  "requested_by_session": "ses_e9a2d9", "summary": "…",
  "created_at": "2026-08-15T20:43:16.262723446+02:00", "self_review": false }
```

`?with=reviews` adds a `reviews` array alongside it. Both keys are optional and
must be typed as such.

**The API returns no epic children.** Neither `GET /v1/issues/{epic}` nor
`?with=tasks` carries a children or tasks field, and `?parent_id=` is not a
filter — passing it returns every issue unchanged. Epic children exist only as
`parent_id` on the children themselves, so they can be assembled client-side or
not at all.

## Approach

Dependencies need titles and statuses the detail payload does not carry, and
epic children need issue rows that no endpoint returns. One mechanism answers
both: load the issue list once and resolve against it in memory.

Rejected alternatives. **N+1 single reads** (`GET /v1/issues/{id}` per
reference) costs one request and one loading state per row and still leaves
epic children unsolved, because nothing hands us the list of child ids to read.
**Bare ids** — today's behaviour — is the least work and fails acceptance
criteria 1 and 5 outright.

## Design

### Data layer

`FETCH_LIMIT` moves from `IssueList.tsx` to `api/queries.ts`. It is td's own
bound on `limit`, not a property of the list view, and it now has two callers.

`useIssueIndex()` joins it: the same `useIssues({ limit: FETCH_LIMIT })` query
with no filters, returning a `Map<string, Issue>`. IssueList already issues
this query, so it is usually a react-query cache hit rather than a second
request. The index deliberately exposes no truncation flag — see below, an
unresolved reference is handled the same way whichever reason produced it.

Resolution lives in `issueIndex.ts` as pure functions, no React, so the part
that is easy to get backwards is the part that is directly testable:

```ts
indexById(issues: Issue[]): Map<string, Issue>
resolve(deps: Dependency[], index: Map<string, Issue>, key: 'depends_on_id' | 'issue_id'):
  { id: string; issue: Issue | null }[]
childrenOf(issues: Issue[], parentId: string): Issue[]
```

An unresolved reference returns `{ issue: null, id }` rather than being dropped
or raising. A capped list and a deleted issue are indistinguishable from here,
and both mean the same thing to the reader: we do not know the title. The row
renders the bare id, exactly as it does today. This is the `available_transitions`
precedent — an absent field means unknown, and the UI invents nothing.

While the index query is loading, or if it fails, every relation renders with
bare ids and no error panel. Titles are enrichment; their absence is not a
failure of the page, and an error panel there would report a problem the reader
cannot act on.

### Relations

`RelatedIssues.tsx` renders one titled group of resolved rows — id, title,
`StatusTag`, link to the issue. Three uses:

| Section      | Source                          | Resolved through  |
| ------------ | ------------------------------- | ----------------- |
| BLOCKED BY   | `dependencies`                  | `depends_on_id`   |
| BLOCKS       | `blocked_by`                    | `issue_id`        |
| TASKS        | `childrenOf(index, issue.id)`   | — (already issues) |

TASKS renders only for `type === 'epic'`.

`DependencyPanel` keeps its add and remove controls and gains resolved rows. It
splits active blockers from resolved ones: a blocker whose issue is `closed` is
no longer blocking, and mixing the two makes a long-finished dependency read as
current work.

### Side column

`MetaPanel.tsx` sits in a right-hand column from the `lg` breakpoint and stacks
below the content on narrower viewports. Every field renders only when present —
no placeholder rows, no em-dashes standing in for null. Three blocks:

- **Metadata** — points, labels, sprint, parent (as a link), due_date,
  defer_until, defer_count, minor, created_branch
- **Attribution** — implementer, reviewer, creator and closed_by sessions,
  shortened with the existing `shortSession`; created, updated, reviewed and
  closed as relative time
- **Review** — see below

`ReviewPanel.tsx` renders `active_review`: decision, reviewer session, relative
time, and the summary. Below it, collapsed, "N earlier reviews" from `reviews`,
each marked `(superseded)`. With no `active_review` the panel renders nothing
at all rather than an empty heading.

`useIssue` requests `?with=reviews` permanently, so history needs no second
query, no extra loading state and no second cache entry per issue.

`types.ts` gains `ActiveReview` and `Review`, both optional on `IssueDetail`.

### Layout

`IssueDetail` becomes a two-column grid at `lg`. The reading order — title,
tags, actions, transitions, description, acceptance, relations, activity,
comments — is unchanged in the main column; the side column carries facts that
would otherwise interrupt it.

## Testing

Pure functions in `issueIndex.test.ts`: resolution through each key, an
unresolved id staying bare, `childrenOf` filtering, an empty index resolving
everything to bare ids.

Component tests with msw: resolved rows versus bare rows, closed blockers
splitting out of the active group, TASKS present for an epic and absent
otherwise, metadata fields omitted when null rather than rendered empty, review
history collapsed and expanded, and a missing `active_review` rendering no
review block.

Two contract tests against a real td, because both pin a fact this design would
silently get wrong:

- the `dependencies` / `blocked_by` direction, asserted from both ends of one
  dependency row
- `active_review` absent before the first review and present after one is
  recorded

## Out of scope

`description` and `acceptance` stay preformatted text. td's modal renders them
as markdown; introducing a markdown renderer is a separate decision with its own
sanitisation questions, and this issue is about fields that are not rendered at
all rather than fields rendered plainly.
