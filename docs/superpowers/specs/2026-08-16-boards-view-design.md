# Boards view: list, backlog reordering and swimlane transitions

td issue: td-2041d2
Date: 2026-08-16

## Problem

td has boards — query-based views over issues, with manual positions for custom
ordering (`td board create/list/show/move/edit/delete`, and a swimlane view in
`td monitor`). td-gui has none. The GUI can show one flat, filtered issue list
and nothing else, so a user who organises work into a sprint board on the CLI
loses that organisation the moment they open the GUI.

## What already exists

**The whole board API is already in `td serve`:**

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/boards` | all boards |
| GET | `/v1/boards/{id}` | one board plus its cards (`?include_closed=true`) |
| POST | `/v1/boards` | create — `{name, query}` |
| PATCH | `/v1/boards/{id}` | update — `{name?, query?}` |
| DELETE | `/v1/boards/{id}` | delete |
| POST | `/v1/boards/{id}/issues` | set a card's position — `{issue_id, position}` |
| DELETE | `/v1/boards/{id}/issues/{issue_id}` | clear a card's position |

`internal/proxy/proxy.go` forwards every path and injects the bearer token; it
has no allowlist. **This feature needs no Go code** beyond one contract test.
`useLiveUpdates` already invalidates the entire query cache on td's SSE
`refresh`, so board data stays fresh with no new plumbing.

### Four findings that shape the design

These came out of reading td's `internal/db/boards.go` and
`internal/serve/handlers_read.go`, and each one rules out an obvious design.

**1. `position` in a request is not `position` in a response.**
`ComputeInsertPosition(boardID, slot)` treats the request value as a *1-based
slot among the rows in `board_issue_positions`* and converts it to a sparse sort
key (gap 1000, respacing when a gap is exhausted). The `position` in the GET
response is that raw sort key — 1000, 2000, 1500. Rendering it as an index, or
sending back what was read, is wrong in both directions.

**2. Positions are board-global, not per status.**
There is one flat position sequence per board. A "reorder within the In Progress
column" gesture would write a position that also orders the card against cards
in every other column.

**3. Unpositioned cards always sort last.**
`ApplyBoardPositions` returns positioned cards (sorted by key) followed by
unpositioned cards in query order. A slot greater than the number of positioned
cards appends *after the last positioned card* — which is the head of the
unpositioned block, not wherever the pointer was released.

**4. Board cards carry no `available_transitions`.**
`IssueToDTO(...).slimForBoard()` drops `description` and `acceptance`; the
transitions field is only ever set on `GET /v1/issues/{id}`. Per the project
invariant the UI renders exactly the transitions td reports and none when the
field is absent, so a board card cannot offer a transition on its own.

### The built-in board is empty by design

`bd-all-issues` ships with `is_builtin = 1` and an empty query. With an empty
query td takes the `GetBoardIssues` path, which returns only explicitly
positioned issues — so the board named "All Issues" returns nothing until
someone positions an issue on it. `cmd/board.go:229` takes the same branch, so
`td board show` is equally empty. This is td's semantics, not an API artifact,
and the GUI reproduces it rather than inventing a second truth.

## Design

### Routes and shell

| Route | Content |
|---|---|
| `/boards` | board list: name, query, `builtin` marker, "New board" |
| `/boards/:id` | one board, `?view=backlog\|swimlanes` |

`AppShell` gains a `Boards` link in the header. New directory
`web/src/features/boards/`, mirroring `features/issues/`. The issue list stays
the start page; no existing route moves.

### Two views, two meanings for a drag

Finding 2 makes a single unified gesture dishonest, so each view carries the
gesture its data model actually supports:

- **Backlog** — a flat ordered list. Dragging reorders and writes a position.
  No status changes.
- **Swimlanes** — columns by status. Dragging across a column boundary opens a
  transition panel. No reordering inside a column, because td stores no order
  there.

`board.view_mode` supplies the initial view. It is read-only: `BoardUpdateBody`
accepts `name` and `query` only, so td's `UpdateBoardViewMode` is unreachable
over HTTP. The GUI's toggle therefore writes to the `?view` search param and
mirrors the last choice per board into `localStorage`; the board form offers no
`view_mode` field, because a control that cannot persist is a lie.

### The backlog view and the pin boundary

Finding 3 means a drop into the unpositioned tail cannot be expressed. Rather
than silently relocating such a drop, the boundary is drawn on screen:

```
▸ Pinned                       positioned cards — drag & drop is exact here
  td-a1b2  …
  td-c3d4  …
──────────────────────────────  "Ordered by the board query below"
  td-e5f6  …                   unpositioned — draggable up, not among themselves
```

Drop targets exist between pinned cards and at the end of the pinned block. A
card from the lower block can be dragged into the upper one, which pins it. Each
pinned card offers "Unpin" (`DELETE /v1/boards/{id}/issues/{issue_id}`), sending
it back below the line. Nothing in the lower block is a drop target.

Slot arithmetic lives in one pure function so finding 1 is tested in isolation:

```ts
/**
 * Where a card lands, as td wants to hear it.
 *
 * `gap` is an index into the pinned block *as currently rendered, including
 * the card being moved* — the card lands before the card now at `gap`. td's
 * ComputeInsertPosition reads the stored rows the same way, so the mapping is
 * simply gap + 1. Returns null for a no-op: dropping a card immediately before
 * or immediately after itself changes nothing and must not issue a request.
 */
export function insertSlot(gap: number, cardIndex: number): number | null
```

That "including the card being moved" clause is the whole subtlety. Moving the
first card down by one is `gap = 2`, not 1: at `gap = 1` td interpolates between
the card and its successor and the card keeps its place. So "Move down" on index
`i` sends `i + 3` and "Move up" sends `i`, both through the same function.

### Drag and drop mechanics

Native HTML5 drag and drop — `draggable`, `dragstart`, `dragover`, `drop` — and
no new dependency. `web/package.json` carries four runtime dependencies and the
Go server uses the standard library only; a drag-and-drop toolkit for one screen
does not fit that.

Keyboard access is explicit rather than emulated: every pinned card carries
"Move up" and "Move down" buttons that call the same mutation with the same
computed slot. That is a visible control instead of a hidden sensor, and it is
what the tests drive.

**No optimistic reordering.** The sort key is computed server-side and may
trigger a respacing pass, so a locally guessed order could differ from what td
stored. While the mutation is in flight the list is `aria-busy` and the moved
card is dimmed; td's answer, arriving over a loopback connection, settles it.

### The transition panel in the swimlane view

A drop across a column boundary opens a panel that fetches
`GET /v1/issues/{id}` with the existing `useIssue` hook — necessary because of
finding 4 — and renders the existing `TransitionBar` unchanged, with its
attribution radios, reason field and verbatim td error text.

The panel does **not** infer an action from the target column. The mapping is
ambiguous (`closed` follows `approve` and `close`; `open` follows `reopen`,
`reject` and `unblock`) and td documents no transition-to-status table. The
panel prints `Dropped on: In review` above the buttons and leaves the choice to
the actions td itself reported. When `available_transitions` is absent or empty,
`TransitionBar` already renders nothing, and the panel says so.

### Board create, edit, delete

Create and edit share a form with `name` and `query`. The TDQ query is not
parsed in the frontend: td answers invalid syntax with
`details.fields[].rule = "tdq_syntax"` and a precise message, which is bound to
the field exactly as `IssueForm` binds td's validation errors today.

Boards with `is_builtin` render no edit and no delete control; td answers those
with 403 `cannot modify builtin board` / `cannot delete builtin board`, so the
control would be a dead end. Deletion uses the existing `ConfirmButton` and
lives on the board list row. The list is also the only place a board is
deleted, so the 403 is unreachable from the UI — what the tests pin is the
absence of the control, not td's wording for a request we never send.

### Cards

A card shows id, title, `PriorityTag` and `StatusTag`, reusing the tokens and
components of the issue list. The whole card links to `/issues/:id`. One card
component serves both views, so it carries nothing view-specific.

Board cards additionally carry `dependency_summary.blockers`: the unresolved
blockers, with closed ones already filtered out by td. A card with blockers
shows a `⛔ 2` badge whose `title` lists the blocking ids. This field is
populated on the board and list paths only, so it is optional on the type.

`category` is present in td's board DTO but never assigned anywhere in
`internal/db`, so it is always `""`. It is neither typed nor rendered.

### Data layer

New types in `api/types.ts`:

```ts
export interface Board {
  id: string; name: string; query: string
  is_builtin: boolean
  view_mode: 'swimlanes' | 'backlog'
  last_viewed_at: string | null
  created_at: string; updated_at: string
}

/** `position` is td's sparse sort key, not an index — sort by it, never show
    it, and never send it back. */
export interface BoardCard {
  issue: Issue          // without description/acceptance
  board_id: string
  position: number
  has_position: boolean
}
```

Queries in a new `api/boards.ts` (`useBoards`, `useBoard(id, {includeClosed})`)
with a `boardKeys` factory alongside `issueKeys`. Mutations join
`api/mutations.ts`: `useCreateBoard`, `useUpdateBoard`, `useDeleteBoard`,
`useSetCardPosition`, `useClearCardPosition`. All of them invalidate
`boardKeys.all` and nothing else — none of them changes issue data, so
`issueKeys` stays untouched.

### Empty and error states

A board whose query is empty gets its own message instead of the generic one:

> This board has no query. It shows only issues positioned on it by hand — drag
> issues here or use `td board move`.

A board with a query and no matches gets the ordinary empty state with a hint to
include closed issues. Query execution errors come back as
`board query error: …` from td and are shown verbatim in `ErrorPanel`, as
everywhere else.

## Testing

- `boards.test.ts` — `insertSlot`: first slot, append past the end, empty pinned
  block, and the two no-op gaps around the moved card. Pure unit tests, no DOM.
- `BoardList.test.tsx` — boards render; a builtin board shows no edit and no
  delete control; the empty list invites creating one.
- `BoardView.test.tsx` — the initial view follows td's `view_mode`, a toggle is
  remembered per board, `include_closed` refetches, and the no-query board shows
  its own message only when it is actually empty.
- `BacklogView.test.tsx` — the pin boundary renders; a drop with a synthetic
  `DataTransfer` posts the expected slot; "Move down" posts `index + 3` and
  "Move up" posts `index`; a drop onto a card's own place sends nothing;
  "Unpin" issues the DELETE.
- `SwimlaneView.test.tsx` — cards land in their status column; a cross-column
  drop opens the panel; a drop inside the same column does nothing.
- `BoardTransitionPanel.test.tsx` — the panel fetches the issue and renders only
  td's reported transitions; it says so when the field is empty or absent.
- `BoardForm.test.tsx` — td's `tdq_syntax` message appears verbatim on the query
  field; an error carrying no field lands in the panel.
- `test/contract` (Go) — one case against a real `td`: create a board with a
  query, position two issues by slot, assert `GET /v1/boards/{id}` returns them
  in that order. This pins finding 1, the assumption most likely to break with a
  future td release.

No new dependency, no Go code outside `test/contract`. `make test` covers the
change; the contract case only runs with `td` on PATH, so check for `--- SKIP`
before trusting it.
