# Epic overview at `/epics` with progress rollup

td issue: td-d3705c
Date: 2026-09-04

## Problem

td has an `epic` issue type and a parent/child hierarchy, and td-gui shows
almost none of it. `IssueType` includes `'epic'`, but nothing branches on it.
The detail view lists direct children under a flat "Tasks" heading, `MetaPanel`
links a parent by bare id, and that is the whole surface.

Two things are missing outright:

- **Progress.** Nothing anywhere reports how far an epic has come. `td tree`
  answers this on the CLI; the GUI has no equivalent.
- **An overview.** There is no way to see the epics of a project at all.
  `td epic list` is CLI-only, and the issue list has no type filter — `listUrl`
  reserves `type` as a URL key but no control sets it.

Structure editing is already there and stays as it is: `IssueFields` renders a
parent combobox in both the create and the edit form, and `issueDiff` sends
`parent_id` in the patch.

## What the data actually looks like

Measured against a real project (`dontenwill-cloudiax`, td v0.65.0), not
assumed:

- 49 issues, of which **30 are epics** — 61%. Epics are used as requirement
  containers (`CX-03`, `CX-04`, …), not as a handful of large initiatives.
- **6 epics have children, each exactly one.** The other 24 have none.
- Maximum tree depth is 2.
- `points` is 0 on every issue.

Three consequences shape the design. An overview of 30 rows has to be scannable
rather than a single tree page. The `0/0` state is the majority case and must
not read as failure. A story-point rollup would be summing zeros.

## What td gives us

`GET /v1/issues` returns `parent_id` and `points` per issue. It returns no
children array and no progress rollup — `issueIndex.ts` already says so:
"Epic children exist only as `parent_id` on the children; no endpoint lists
them."

That is enough. `useIssueIndex` already fetches the full set in two queries,
open and closed, each capped at td's maximum of 1000. Every number this feature
needs is derivable from data the app holds in cache.

## Scope

One new route, `/epics`, holding the overview. The epic *detail* stays
`/issues/:id`.

A separate epic detail route was considered and rejected. An epic is an
ordinary issue in td, with the same transitions, review policy and comments, so
a second detail screen would either duplicate `TransitionBar`, `ReviewPanel`,
`CommentForm` and `IssueEditForm` or ship without them.

### No server change

`/epics` reads `useIssueIndex()`. No Go route, no third `/gui/` exception, no
further `td` subprocess. The hierarchy is fully derivable from `parent_id`, so
shelling out to `td tree` would buy nothing and would cost a third departure
from the proxy.

The index cap is a real limit and is surfaced rather than hidden: if either
half returns exactly `FETCH_LIMIT` rows, the page shows a notice that the
rollup may undercount. A wrong number presented as fact is worse than an
admitted gap.

## What counts as an epic

`type === 'epic'` — the same definition `td epic list` uses.

Deliberately *not* "any issue with children". Commit `228b1ad` established that
`parent_id` carries no restriction to epic parents, and the detail view keys
its Tasks group off having children rather than off type. Those two rules
coexist: a `feature` with children keeps showing its tasks on the detail view
and does not appear in the epic overview. Two questions, two answers.

## Progress

A pure module, `features/epics/epicRollup.ts`, with no React dependency.

- **Counted:** all descendants, transitively over `parent_id`. Depth is 2 today
  but td permits deeper trees, and "progress of this epic" means the whole
  subtree.
- **Done:** `status === 'closed'`, and nothing else. That is td's own answer to
  the question, not an interpretation layered on top.
- **Cycle guard:** a visited set. `candidatesFor` excludes only the issue
  itself and its direct children, so a longer `parent_id` ring is reachable
  through the API and must not hang the render.
- **Buckets:** counts per status, so the bar can be segmented.
- **No point rollup.** `points` is 0 everywhere; summing it is YAGNI.

`0/0` is its own state, rendered as "no tasks" rather than 0%. With 24 of 30
epics in that state, a bar at zero would make undecomposed work look like
failed work.

## The overview

Rows sorted by priority, then creation date, so CLI and GUI agree. That this is
`td epic list`'s own order was verified against the 30-epic project, not
assumed: `(priority, created_at)` reproduces its output exactly, and
`(priority, title)` does not.

Each row: expand chevron, id, priority, title, a "+ Task" action, and the
progress bar with its `closed/total` count. Closed epics are hidden by default
behind a chip toggle.

The bar is **segmented by status**, with a legend. With most epics holding a
single child, `0/1` is the common case, and whether that child is untouched or
sitting in review is exactly what the page is opened to find out. A single-tone
bar cannot express that difference.

Expanding shows the **direct** children only, as `RelatedRow` from
`RelatedIssues.tsx` — shared markup, not a second row style. Expansion state
lives in component state, not the URL.

Because the rollup counts transitively while the list shows one level, a deep
tree would show a count larger than its visible rows. Rather than building a
multi-level tree for a depth that does not exist, a child row that itself has
children carries its own small count. The numbers then reconcile on screen.

Empty state: an `EmptyState` explaining that an epic is an issue of type
`epic`, linking to `/new`.

## Detail view additions

1. A rollup line above the existing Tasks group, using the **same** bar
   component as the overview. It appears whenever an issue has children —
   including a non-epic parent, consistent with `228b1ad`.
2. `MetaPanel` renders the parent with its title, not just its id. The index
   already holds the title.
3. A "+ Task" action, on the same target as the overview.

## Creating a task under an epic

Both "+ Task" actions link to `/new?parent=<id>`. `IssueForm` does not read
query parameters today; it will seed `draft.parent_id` from `parent` when
present, and otherwise behave exactly as now.

This is the workflow gap that structure editing leaves open. The parent
combobox lets you attach a child once you are already looking at the child;
nothing lets you work outward from the epic.

## Language

All UI strings are English, per `CLAUDE.md`. Status wording follows the
existing `statusLabel.ts`; nothing here introduces new vocabulary for states td
already names.

## Testing

Vitest and Testing Library, beside the code, as elsewhere in the repo.

- `epicRollup.test.ts` — descendants across depths, the cycle guard, status
  buckets, the `0/0` case, and an issue whose parent is absent from the index.
- `EpicProgress.test.tsx` — segment widths per bucket, the "no tasks" state.
- `EpicList.test.tsx` — epic selection by type, sort order, expand/collapse,
  the closed toggle, the empty state, the cap notice.
- Additions to `IssueDetail.test.tsx`, `MetaPanel.test.tsx`,
  `IssueForm.test.tsx`, `AppShell.test.tsx`.

No Go tests and no `test/contract` addition: the server is unchanged and td's
contract is untouched.

## Files

New:

- `web/src/features/epics/epicRollup.ts`, `epicRollup.test.ts`
- `web/src/features/epics/EpicProgress.tsx`, `EpicProgress.test.tsx`
- `web/src/features/epics/EpicList.tsx`, `EpicList.test.tsx`

Changed:

- `web/src/App.tsx` — route `/epics`
- `web/src/components/AppShell.tsx` — nav entry
- `web/src/features/issues/IssueDetail.tsx` — rollup line, "+ Task"
- `web/src/features/issues/MetaPanel.tsx` — parent title
- `web/src/features/issues/IssueForm.tsx` — read `?parent=`
- `docs/` — user documentation and a screenshot

## Out of scope

- Drag and drop of tasks between epics. Boards own that mechanic; a second one
  here would fragment it.
- A story-point rollup.
- An epic board or per-epic swimlanes.
- A `/gui/` route wrapping `td tree`.
- A dedicated epic detail route.
