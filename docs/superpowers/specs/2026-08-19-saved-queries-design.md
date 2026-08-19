# Saved queries in the issue list search bar

The search box can save the TDQ it holds, load a saved one back, and write a
changed one back to where it came from. Saved queries are not a new kind of
object: they are boards.

## The problem

The box takes a TDQ query behind a leading `?`, and that query lives exactly
as long as the URL that carries it. A reader who works out
`type = bug AND priority <= P1 AND assignee = @me` has to keep it somewhere
outside td-gui, or type it again tomorrow.

## Why boards

td already has the concept. `docs/boards.md` opens with the sentence "A board
is a saved query", and a board is a name plus a TDQ expression, stored by td
and reachable over the API td-gui already proxies:

- `GET /v1/boards` — `useBoards()`, cached, already fetched by the boards page
- `POST /v1/boards` — `useCreateBoard()`
- `PATCH /v1/boards/{id}` — `useUpdateBoard(id)`, name and query only

Introducing a second store for saved searches would mean a second query
concept sitting next to boards with no way to tell a reader which one they
should have used, and it would make td-gui hold project state of its own for
the first time. The architecture invariant is that td owns truth; a saved
query is truth.

The cost, accepted: every query saved from the search box also appears on the
boards page. That is the honest consequence of them being the same thing.

## What a board can hold, and what it cannot

A board carries `name` and `query`. `PATCH /v1/boards/{id}` accepts nothing
else, so the status chips and the sort order are **not** saved. They stay what
they are today: what the reader turns after the query has landed. Loading a
saved query therefore changes `q` and leaves the rest of the list state alone.

## The shape of the URL

One new parameter beside the four `listUrl.ts` already writes:

| Parameter | Meaning | Example |
| --- | --- | --- |
| `board` | the board the query in `q` came from | `/?q=type+%3D+bug&board=brd-7f3a` |

`q` is still the only thing that runs. `board` is provenance, nothing more. It
is written only alongside `q`; a `board` without a `q` is not a state the app
can produce, and `readListUrl` drops the parameter rather than fetching the
board's query, because the URL says what runs and a lookup would make it say
something else.

Whether the id names a board that still exists is not `listUrl.ts`'s question
to answer — it is two pure functions with no access to the board list, and it
stays that way. An id nothing answers to reaches `SavedQueryBar`, which finds
no board for it and renders the bar as if there were no `board` at all:
**Save**, on an unnamed query. A board deleted from another tab therefore
costs the reader an offer to save, not an error.

Three states follow from `q` and `board` together, and they are what the bar
renders:

| `board` | `q` vs the board's query | The bar offers |
| --- | --- | --- |
| absent | — | **Save** |
| present | equal | nothing to save |
| present | different | **Update "Bugs P1"** and **Save as new** |

The comparison is on the exact string. Whitespace differences count as a
change, which is the conservative direction: it offers a write that turns out
to be a no-op, rather than hiding one the reader wanted.

## The picker

A button beside the search box opens a menu of the project's boards, each
shown as name over query, the way the boards list shows them. Choosing one
sets `q` and `board` and runs immediately, without Enter: a saved query is
finished by definition, and the Enter rule exists to protect half-typed ones.

**Boards with an empty query are not listed.** An empty query means two
different things depending on the board, and neither of them survives the trip
into the search box:

- on the builtin *All Issues*, td fills it with the whole project
- on a board you made, it means the board shows only the cards you placed on
  it by hand

In the search box an empty TDQ matches everything, so listing either kind
would quietly turn a board into a different set than the board shows. The
builtin drops out of the menu with them, and that is right: its equivalent in
the search box is the empty box.

Not a combobox with type-ahead. A project has a handful of boards, and typing
to filter a list that short is longer than reading it. `LabelInput` sets the
precedent for where a combobox earns itself, and this is under that bar.

## Writing

**Save** opens a name field under the bar rather than a modal: the list below
is the evidence that the query is the right one, and a dialog would cover it.
Submitting posts to `/v1/boards` and, on success, sets `board` in the URL to
the new id, which moves the bar into its "saved and unchanged" state.

**Update** sends the current `q` with the board's existing name, and asks
nothing first. The query is on screen and its results are under it, so there
is no hidden consequence to confirm; `docs/boards.md` describes deletion as
the operation that asks, and this is not that.

**Save as new** is the Save flow with the name field prefilled empty, and it
leaves the original board untouched.

Names are td's to judge. The field renders `FieldError` exactly as `BoardForm`
does, so a name td rejects comes back in td's own words. Nothing in the
browser checks the length. Likewise the query: it is saved as typed, and a
query td cannot parse has already failed visibly in the list above.

td answers `403 cannot modify builtin board` for the builtin. That cannot be
reached here, because the only builtin has an empty query and so is not in the
menu, but the error is displayed rather than swallowed if td's board set ever
changes.

Renaming and deleting stay on the boards page. Rebuilding the name field's
other half here would be rebuilding `BoardForm`, which is one route away.

## What changes

**New: `web/src/features/issues/SavedQueryBar.tsx`.** The picker button, the
menu, the Save/Update buttons and the name field. It is handed the current
query and board id and reports both back up; it holds no list state of its
own.

**`listUrl.ts`** reads and writes `board`, with the "only beside `q`" rule in
`readListUrl`.

**`IssueFilters.tsx`** renders the bar beside its input and passes changes to
the same `onChange` it already has. Its own behaviour — the `?` prefix, the
debounce, Enter, the clear button — is untouched.

**`IssueList.tsx`** is unchanged beyond what `readListUrl`/`writeListUrl`
already carry for it.

Nothing changes on the Go side: no route, no subprocess, and the board calls
go through the proxy to `td serve` like every other write.

## Tests

- `listUrl.test.ts` — `board` round-trips beside `q`; a `board` without a `q`
  is dropped.
- `SavedQueryBar.test.tsx` — the three states of the bar; an id that names no
  board falls back to the first of them; a board with an empty query is absent
  from the menu; choosing one sets query and id;
  Save posts and reports the new id; Update patches with the board's name;
  a name td rejects renders td's message under the field.
- `IssueFilters.test.tsx` — the bar appears only when the box holds a query,
  and the existing search behaviour is unaffected.

## Documentation

`docs/issues.md` gains a paragraph under **Queries** on saving one, and
`docs/boards.md` gains one sentence saying boards are where those saved
queries land, so neither page describes the feature as if the other did not
exist.
