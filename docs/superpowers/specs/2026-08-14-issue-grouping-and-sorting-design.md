# Issue list: status grouping and group-aware sorting

Status: approved, not yet implemented.
Issue: td-43e9ce.

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
pinned to `FETCH_LIMIT = 500` and `offset` is gone. If `total` exceeds the rows
returned, the list says so above the header row rather than silently showing a
partial picture:

    Showing 500 of 812 — refine the filters to narrow this down.

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

- **`FETCH_LIMIT` is a guess.** 500 is chosen to be comfortably above any
  plausible td project without being unbounded. It is a single constant, and
  the cap notice makes the case where it binds visible rather than silent.
- **The row is getting crowded.** Five columns at 13px on a narrow window
  leaves little for the title, which truncates. Worth looking at in the running
  app rather than reasoning about.
- **Removing pagination is hard to walk back.** If a project turns out to have
  thousands of issues, the answer is server-side sorting in td, not
  reinstating a pager that sorts a slice.
