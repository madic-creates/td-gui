# Use the page width in the issue detail view

td-5d10d5 · 2026-08-16

## The problem

On a wide window the issue detail view wastes its horizontal space and spends
its vertical space badly.

Seven rows stack above the description: the back link, the mono id, the title,
the tag row, the `Edit Focus Delete` bar, a horizontal rule, and the transition
buttons. Below them the prose is capped at `max-w-[68ch]` while the grid track
holding it is `minmax(0,1fr)` — at a 1700px window that leaves roughly 600px of
the main column empty, and pushes Activity and Comments below the fold.

Nothing constrains the page: `AppShell` renders `<main>{children}</main>` with
no maximum width, so the layout keeps stretching however wide the window gets.

## What changes

Three changes, all structural. No mutation, query, or error path is touched.

### 1. The page gets a maximum width

`AppShell` centres its content at `max-w-[1440px]`. The header's bottom border
stays full-bleed across the window; only its contents centre, so the logo lines
up with the body below it.

`SwimlaneView` already scrolls horizontally (`overflow-x-auto`), so a narrower
container makes it scroll sooner rather than break.

### 2. The header condenses from seven rows to four

| Row | Content |
| --- | --- |
| 1 | `← back to list` · the mono issue id, on one baseline |
| 2 | The title |
| 3 | The tag row left, `Edit Focus Delete` right (`justify-between`) |
| 4 | The transition buttons, with no rule above them |

The header also moves out of the first grid cell and becomes a full-width band
above the columns. That is what gives the open editor — whose field grid is
`sm:grid-cols-4` — the whole width instead of a 544px column.

**Rows 3 and 4 cannot merge.** `TransitionBar` renders its own `<form>` for the
reason on reject, block, close and approve, and `IssueEditForm` is a `<form>`
too; nesting them is invalid HTML. Moving `IssueActions` out of the edit form
instead is ruled out by the constraint documented on `IssueEditForm`: its
position in the tree is load-bearing, because a move is a remount and react-query
stops calling a mutation's mutate-level callbacks when its observer loses its
listeners — a delete in flight would lose the `navigate('/')` that follows it.
Four rows is what the existing constraints allow.

### 3. The body splits into prose and structure, from 1280px up

```
grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]        ← unchanged
  ├ grid gap-x-6 xl:grid-cols-[minmax(0,68ch)_minmax(0,1fr)]   ← new
  │   ├ column 1   Description · Acceptance criteria · Latest handoff ·
  │   │            Comments and the comment form
  │   └ column 2   Depends on / Resolved and the add-dependency form ·
  │                Blocks · Tasks · Activity
  └ aside          MetaPanel · ReviewPanel
```

The split is a **nested** grid, not a flat three-column one. A flat
`grid-cols-3` with three children would wrap the sidebar under column 1 at the
`lg` breakpoint, where only two tracks exist. Nesting keeps the outer grid
exactly as it is today and subdivides its `1fr` track only at `xl`.

Below 1280px the inner grid is single-column, which is the stacking order the
view already has — so narrow windows are unaffected.

At a 1440px window: roughly 545px of prose (68ch, whatever that resolves to in
the body font), about as much again for structure and log, and 260px of
metadata. Activity sits beside the description instead of under the fold.

The division is by kind, not by length: column 1 is what a person wrote about
the issue, column 2 is what the issue is connected to and what happened to it.
That assignment is fixed rather than content-dependent, so a missing field
never reshuffles the layout.

`max-w-[68ch]` stays on the prose paragraphs even though the `xl` track already
caps them — at `lg` and below the track is wide and the cap is what keeps the
line length readable.

## What is not touched

`MetaPanel`'s internals, `ReviewPanel`, the activity row markup, and every
mutation and error path. The change is grid structure and utility classes.

## Testing

This is layout. `IssueDetail.test.tsx` and `AppShell.test.tsx` assert on text
and behaviour, not on DOM structure, so they should stay green as written; if
one breaks it means a structural change moved something a test legitimately
depends on, and that is worth knowing.

No new tests are added. A test asserting "these two elements share a row" would
assert on Tailwind class names, not on behaviour — it would pass on a layout
that renders wrongly and fail on a refactor that renders identically.
Verification is `make test` green plus the running app checked in a browser at
a wide and a narrow window.
