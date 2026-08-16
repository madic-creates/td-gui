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
up closely with the body below it — each view sets its own inner padding
(`p-4` on the list and board views, `px-5` on the issue detail page), so the
alignment is close rather than pixel-exact.

`SwimlaneView` already scrolls horizontally (`overflow-x-auto`), so a narrower
container makes it scroll sooner rather than break.

The cap is app-wide, so it also reaches the `border-b` toolbars inside
`<main>` — `IssueFilters` above the issue list and the board-name bar in
`BoardView` — which used to span the window and now stop at 1440px like
everything else in the column. That was considered and accepted rather than
carved out as an exception. The alternative, a `w-screen` /
`mx-[calc(50%-50vw)]` breakout to push those two bars back to the window
edges, was tried and reverted: `vw` units include the scrollbar's width while
a percentage margin resolves against the content box, so on any window with a
classic (non-overlay) vertical scrollbar the breakout overhangs the right edge
by half a scrollbar width and produces real horizontal scroll. That is not a
narrow edge case — the issue list is the app's home page and scrolls
vertically as soon as a project has more than a screenful of issues.

### 2. The header condenses from seven rows to four

| Row | Content |
| --- | --- |
| 1 | `← back to list` · the mono issue id, on one baseline |
| 2 | The title |
| 3 | The tag row left, `Edit Focus Delete` right |
| 4 | The transition buttons, with no rule above them |

The header also moves out of the first grid cell and becomes a full-width band
above the columns. That is what gives the open editor — whose field grid is
`sm:grid-cols-4` — the whole width instead of a 544px column.

Row 3 puts two things on one line that today own a row each. `IssueActions`
renders a button row *and*, below it, the panel carrying td's rejection message
— so making its root a flex item would squeeze that message into a column the
width of three buttons. Instead its root element goes away entirely: it returns
a fragment, and the header row is a two-column grid, so the button row takes the
right-hand cell while the error panel takes a `col-span-full` row of its own
underneath. td's wording keeps the whole width, which is the point of showing it
unchanged.

This does move `IssueActions` one level deeper in the tree, and
`IssueEditForm`'s documented constraint is that a move is a remount. The
constraint is about a remount *within* a session, triggered by `editing`
toggling — the new structure is identical in both states, so nothing remounts
while the page is open. `IssueDetail.test.tsx:251` already asserts exactly this
and is the guard on the change.

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

At a 1440px window the prose track takes exactly its 68ch measure — 505.6px,
since the body font is 13px — the sidebar takes 260px, and everything
left over (586.4px) goes to structure and log. No track has slack, which
is the point: the log column is sized by subtraction, so there is no width left
over to sit empty. Activity ends up beside the description instead of under the
fold.

The division is by kind, not by length: column 1 is what a person wrote about
the issue, column 2 is what the issue is connected to and what happened to it.
That assignment is fixed rather than content-dependent, so a missing field
never reshuffles the layout.

`max-w-[68ch]` stays on the prose paragraphs even though the `xl` track already
caps them — at `lg` and below the track is wide and the cap is what keeps the
line length readable.

**One consequence on narrow windows.** Stacked, the columns read in order, so
Comments moves from last to just after the handoff, ahead of the dependency and
activity sections. That is the cost of putting Comments in the prose column, and
it is accepted rather than worked around: comments are the other half of what a
person wrote about the issue, and reading them next to the description is at
least as defensible as reading them after the machine log.

## What is not touched

`MetaPanel`'s internals, `ReviewPanel`, the activity row markup, and every
mutation and error path. The change is grid structure and utility classes.

## Testing

This is layout. `IssueDetail.test.tsx` and `AppShell.test.tsx` assert on text
and behaviour, not on DOM structure, so they should stay green as written; if
one breaks it means a structural change moved something a test legitimately
depends on, and that is worth knowing.

The new tests assert **DOM relationships**, never class names. "These two
elements share a parent" and "this component has no root element of its own"
are structural facts a restructure can genuinely break; `className` contains
`xl:grid-cols-…` is not — it would pass on a layout that renders wrongly and
fail on a refactor that renders identically. Whether the result reads well at a
given width is beyond what jsdom can answer, so it is checked in a browser at
1600px, 1200px and 900px, in both themes, with the editor open and with a
rejected transition on screen.
