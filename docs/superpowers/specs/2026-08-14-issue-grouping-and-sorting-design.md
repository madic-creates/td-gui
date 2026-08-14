# Issue list: status grouping and group-aware sorting

Status: implemented.
Issue: td-43e9ce.
Plan: `docs/superpowers/plans/2026-08-14-issue-grouping-and-sorting.md`.

Three things came out differently from this document, all recorded here rather
than quietly absorbed:

- **The grouping and sorting module is `ordering.ts`, not `grouping.ts`.** It
  holds both, because sorting is only ever defined *within* a group; two files
  would have put one half of a single rule in each.
- **The priority column is `w-12` and right-aligned, not sized to its data.**
  It was first sized for the cell's `P0` and then wrapped its own `PRIO ▴`
  header onto a second line, inflating the header row to 46px. A column is
  sized for the longer of its header and its values. jsdom performs no layout,
  so no unit test can catch that class of defect — the guards are
  `whitespace-nowrap` on the header buttons and looking at the running app.
- **Group presence is asserted through the section landmark, not its text.**
  The status filter chips render the same words as the group headers, so a
  text query matches the filter bar while the skeleton is still on screen.

## Problem

The issue list is a flat run of rows in whatever order `td serve` returns.
There is no way to see at a glance how work is distributed across statuses,
and no way to reorder the list at all. On a project with more than a screenful
of issues, finding the two things currently in progress means reading every
row.

## Goal

Group the list by status, make the groups visually distinct, and let the user
sort rows *within* a group. Group order never changes; sorting rearranges rows
inside each group and never moves an issue across a group boundary.

## Constraint that shapes everything: the server cannot sort

`GET /v1/issues` accepts `status`, `type`, `priority`, `search`, `limit` and
`offset`. It has no sort parameter — verified against `td` v0.57.0 by probing a
live `td serve`: `sort=created_at` and even `sort=bogus` are accepted silently
and change nothing. Unknown query parameters are ignored rather than rejected,
so there is no way to feature-detect a future one either.

Sorting therefore happens in the client. That is only honest if the client
holds the whole result set: sorting 50 of 203 issues by priority would put the
page's own P2 rows above P0 rows sitting on page 2.

**Decision: the list fetches everything and pagination is removed.** `limit` is
pinned to `FETCH_LIMIT = 1000` and `offset` is gone. If `total` exceeds the rows
returned, the list says so above the header row rather than silently showing a
partial picture:

    Showing 1000 of 1812 — refine the filters to narrow this down.

Each group header also marks its count as `112+` when the set is truncated, so
the qualification travels with every count instead of sitting only at the top,
where a user scrolled down to `closed` would never see it.

The database is local and single-user, so one larger request is cheaper than
the round trips it replaces.

This removes the stale-offset guard added in `52b1e5f` (keeping `prev`
reachable when a live update empties a later page). That is a simplification,
not a regression: the guard exists *because* of offsets, and the failure it
guards against cannot occur when every request starts at zero.

## Non-goals

- **Server-side sorting.** Out of our hands; belongs in td.
- **Grouping by anything other than status.** No `group by` control. Epic and
  sprint grouping are plausible later; nothing here should block them, but
  building the switch now would be scaffolding for a decision not yet made.
- **Sticky group headers.** Tempting at 500 rows, but the application header is
  not sticky either, so a sticky group header needs a top offset that has to be
  maintained against every future header change. Cheap to add later.
- **Persisting the sort choice.** It resets on reload, like the filters do.

## Grouping

A pure module, `features/issues/ordering.ts`, with no React in it. Grouping and
sorting live together because sorting is defined *within* a group; splitting
them would put one half of a single rule in each file.

Group order is fixed and reflects attention, not the alphabet:

    in_progress → open → in_review → blocked → closed

Empty groups are omitted entirely — an empty `blocked` section is noise.

**A status we do not recognise gets its own group, appended after the known
ones, in first-seen order.** An issue must never vanish from the list because
td grew a status we have not heard of. This mirrors `StatusTag`, which already
renders an unknown status verbatim instead of falling back to a placeholder.

## Sorting

Same module. Keys: `id`, `title`, `priority`, `updated`. Direction: `asc` or
`desc`.

The default is **priority ascending** (P0 first), which is the order `td serve`
already returns, so the first render looks the way it does today.

- `priority` compares by position in `P0 … P4`, not lexicographically, so an
  unrecognised value sorts to the end instead of landing in the middle.
- `updated` compares parsed timestamps, never the raw strings. td emits offsets
  such as `+02:00`, and across a daylight-saving change a string comparison
  orders wrongly. An unparseable timestamp sorts last, consistent with
  `relativeTime` returning `''` for one.
- `title` uses `localeCompare`.
- Every sort breaks ties on `id`, so the result is a total order. Without this,
  an SSE refetch could reshuffle equal rows and make the list twitch.

## Visual treatment

Each group opens with a header: a 2px bar in the status colour
(`--color-st-*`, already defined), the status name, and the row count on the
right, set on `bg-surface-inset` with a `border-line` rule.

Colour never carries the meaning alone — the status name sits next to the bar,
so the grouping survives without colour perception. The palette is unchanged;
the existing contrast table still holds.

Because the whole result set is loaded, the count is the real number of issues
in that status for the current filters — not a per-page figure. When the cap
binds, the notice above the list is what says so; the group counts stay
literal counts of what is displayed.

## Column header row

A new header row above the list, with the sortable columns as buttons:

    ID ▴     TITLE          PRIO     UPDATED     STATUS

`STATUS` is not sortable: it *is* the group, so sorting by it would be a no-op.
The active column shows ▴ or ▾; clicking the active column flips the direction,
clicking another switches the key and resets to ascending.

Sorting by `updated` requires an `UPDATED` column to exist — a clickable header
over an invisible column is a trap. The row therefore gains a right-aligned
relative-time cell rendered with the existing `relativeTime` helper.

**No `aria-sort`.** The list is a `<ul>` of `<li>`, not a table or grid, and
`aria-sort` is only meaningful on table headers. Faking table semantics to
borrow the attribute would be worse than describing the control plainly, so
each button carries an explicit label: `Sort by priority, ascending`.

### One shared source for the column widths

The row and the skeleton already duplicate `w-[74px]`, `gap-3` and `px-4`.
That duplication is exactly what produced the height drift fixed in `4ce3b18`.
The header row would be a third copy, and the `UPDATED` column adds a fifth
column to all three at once.

The column classes move into one module that the row, the skeleton and the
header all import. This is in scope because the change would otherwise make an
existing weakness measurably worse.

## Components

- `features/issues/ordering.ts` — new. `STATUS_ORDER`, `groupByStatus`,
  `sortIssues`, the sort key/direction types. Pure, no React.
- `api/queries.ts` — `IssueListParams` drops `offset`; `limit` is supplied by
  the caller as before, now always `FETCH_LIMIT`.
- `features/issues/IssueListHeader.tsx` — new. The sortable column header row.
- `features/issues/IssueGroupHeader.tsx` — new. One group's header bar.
- `features/issues/columns.ts` — new. The shared column class names.
- `features/issues/IssueList.tsx` — holds the sort state, renders groups,
  loses the `Pagination` component and the offset handlers, gains the
  cap notice and the `UPDATED` cell.
- `components/SkeletonRows.tsx` — adopts the shared column classes and gains a
  bar for the new column.

## Testing

Unit tests for the pure module, where the real logic lives:

- Group order is the fixed order, regardless of input order.
- Empty groups are omitted.
- An unknown status becomes its own trailing group and keeps its issues.
- Each sort key, in both directions.
- An unrecognised priority sorts last, not lexicographically.
- An unparseable `updated_at` sorts last.
- Equal rows come back in `id` order (stability).

Component tests in `IssueList.test.tsx`:

- Group headers render with the right counts.
- Clicking a column header reorders rows within a group and moves nothing
  across a group boundary.
- Clicking the active column flips the direction.
- The cap notice appears when `total` exceeds the rows returned, and stays
  absent otherwise.

The existing pagination test goes away with the pagination.

## Risks

- **`FETCH_LIMIT` is no longer a guess.** This document originally picked 500
  as a round number. `td serve` validates `limit` as 1–1000 and rejects
  anything larger outright, so 1000 is the most a single request can carry —
  the constant is now td's bound rather than our estimate. The coupling is
  real: if td ever lowered its maximum, every list request would fail with a
  validation error rather than degrade.
- **The row is getting crowded.** Five columns at 13px on a narrow window
  leaves little for the title, which truncates. Worth looking at in the running
  app rather than reasoning about.
- **Removing pagination is hard to walk back.** If a project turns out to have
  thousands of issues, the answer is server-side sorting in td, not
  reinstating a pager that sorts a slice.
