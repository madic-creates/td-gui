# Setting an issue's status from the edit form

The issue edit form gains a `Status` select listing all five statuses. Saving
runs td's own transition where td reports one, and falls back to td's CLI for
the three jumps `td serve` cannot express.

## The problem

td-gui can already move an issue through td's workflow: the detail page and
both board views render exactly the transitions td reports in
`available_transitions`, with the reason and attribution forms those actions
take. What it cannot do is set a status.

The gap is not cosmetic. td's transition graph is one-directional in places,
and `td serve` v0.57.0 exposes no route for the moves that go back:

- `POST /v1/issues/{id}/unstart` is a 404. `unstart` never appears in
  `available_transitions` either, so an issue started by mistake stays
  `in_progress` until it is reviewed, blocked or closed.
- `PATCH /v1/issues/{id}` with `{"status": "open"}` answers `ok` and silently
  ignores the field. There is no arbitrary status set over the API, and no
  error to tell a caller so.

Both moves exist in the CLI. Someone working in td-gui has to drop to a
terminal for them.

## What td actually allows

Measured against a real `td` v0.57.0, not assumed. `td update --status` is
**not** a free set: it enforces its own rules and refuses with
`invalid transition from closed to blocked`. Its rules are broader than
`available_transitions`, but not by much.

| From | Reachable via `td serve` | Reachable only via the CLI | Refused by td |
| ---- | ------------------------ | -------------------------- | ------------- |
| `open` | `in_progress`, `in_review`, `blocked`, `closed` | – | – |
| `in_progress` | `in_review`, `blocked`, `closed` | `open` | – |
| `in_review` | `open`, `closed` | `in_progress` | `blocked` |
| `blocked` | `open`, `closed` | `in_progress` | `in_review` |
| `closed` | `open` | – | `in_progress`, `in_review`, `blocked` |

Three jumps need the CLI. None of them closes an issue, which matters: a close
performed by `td update --status closed` leaves `closed_at` null,
`closed_by_session` empty and no review record, and that degraded close is
never on a path this design uses, because every source status reaches `closed`
through a transition td reports.

The two CLI commands are not equivalent, either:

- `td unstart` writes a `Reverted to open` entry to the session log.
- `td update --status open` reaches the same status and writes nothing.

So the override runs `td unstart` when the target is `open`, and
`td update --status` only where nothing more specific exists.

## The control

`IssueEditForm` gains a `Status` select beside Type and Priority, part of the
edit draft like every other field. It lists all five statuses.

Choosing a value other than the current one expands one inline block below the
field grid, full width, in the same idiom as TransitionBar's reason form. The
block names the action Save will run and collects what that action takes.

### Choosing the action

Never from a status graph hardcoded in the frontend. `available_transitions`
is td's answer and stays the input; the only local knowledge is which status
each transition results in:

| Transition | Resulting status |
| ---------- | ---------------- |
| `start` | `in_progress` |
| `review` | `in_review` |
| `block` | `blocked` |
| `close`, `approve` | `closed` |
| `reject`, `unblock`, `reopen` | `open` |

- **A reported transition reaches the target** — run it, through `td serve`,
  exactly as the transition buttons do today. The inline block asks for what
  TransitionBar already asks for: a reason for `reject`, `block` and `close`,
  the attribution radio group for `approve`. It names the action too, because
  choosing `open` from `in_review` means `reject`, and that records a
  rejection the user should know they are recording.
- **No reported transition reaches it** — the override path, behind an inline
  confirm.
- **`available_transitions` absent** — the select is disabled. td-gui renders
  no transition it was not told about, and this is the same rule.

Where two transitions reach one status, prefer the one carrying review
meaning: `approve` over `close`. In practice td never offers both at once.

### The confirm on the override path

The confirm states what the jump costs, and the two cases differ:

- `in_progress → open` runs `td unstart`, which logs `Reverted to open`. The
  confirm says the change is recorded.
- `in_review → in_progress` and `blocked → in_progress` run
  `td update --status`, which writes no log entry. The confirm says the change
  leaves no trace beyond `updated_at`.

### Refused jumps are offered, not disabled

The five combinations td refuses are selectable. Save attempts them, td
refuses, and td's wording is what the user reads. td-gui does not keep a table
of td's rules to grey out options: it would duplicate authority that belongs
to td and drift when td changes. This is the same contract as every other
validation in the app.

## Save semantics

A status change is never part of td's PATCH, so Save is two requests:

1. PATCH the changed fields, if any changed.
2. Run the status action.

In that order, which means a refused status change lands after the fields are
already written. The form reports that state in two parts rather than one
ambiguous failure:

> Fields saved. Status change refused: `<td's message>`

The select keeps the chosen status so the user can retry or set it back, and
the form stays open. A refusal is never rendered as a failed save of the whole
form, because the fields did save.

## The server route

`internal/tdstatus`, a sibling of `internal/tdquery`, answering
`POST /gui/status`. It is the second route to leave the proxy and the only one
that writes, and it is fenced the way `tdquery` is:

- Body `{"id": "...", "status": "..."}`. The status is validated against the
  five known values before anything spawns, so an arbitrary string never
  reaches td's argv as a flag value.
- The handler picks td's most faithful command for the target: `td unstart`
  when the target is `open`, `td update --status <status>` otherwise. That
  table is knowledge about td's CLI, not about presentation, so it lives in Go
  in one place.
- Arguments are separate argv elements with no shell, and the id goes behind a
  `--`, for the reason `tdquery` documents: without it td's flag parser claims
  a leading-dash argument as its own.
- td's stderr comes back verbatim in the `ApiError` shape the frontend already
  renders.
- The route is `/gui/`, never `/v1/`. That prefix is td's API; `/gui/` says
  which half of the surface a caller is on and marks what gets deleted when
  `td serve` grows the endpoint.

The architecture invariant it bends is the same one `tdquery` bends, and the
same limits hold: no database is opened, no `td init` is run, and td's own
binary owns the rules and phrases the failure. Unlike `tdquery`, this one
writes. That is why it is restricted to the jumps `td serve` cannot express,
rather than becoming the general path for status changes: everything td
reports as a transition still goes through the API.

## Frontend wiring

- `useSetStatus` in `web/src/api/mutations.ts`, beside `useTransition`,
  invalidating through the existing `invalidateIssueData`.
- The reason and attribution fieldset moves out of `TransitionBar` into a
  shared component, so the edit form and the transition bar render one
  implementation. `TransitionBar`'s behaviour does not change.
- `IssueEditForm`'s save becomes the two-step sequence above.

## Testing

- Go unit tests in `internal/tdstatus`: status validation, command choice per
  target, argv construction including the `--`, stderr passthrough.
- `test/contract`: the matrix above driven against a real `td`, so the three
  override jumps and the five refusals are pinned rather than remembered. This
  is what catches td changing its rules under us.
- Vitest: the select lists five statuses; a transition-backed target routes to
  the transition endpoint with its reason or attribution; an override target
  will not save until the confirm is acknowledged; the confirm names the log
  consequence for its case; a refused change renders td's message verbatim
  next to the fields-saved note.

## Limits accepted

- A CLI write does not pass through `td serve`, so another open tab may not
  receive an SSE `refresh` for it. The acting tab refetches through its own
  cache invalidation.
- The override is not offered in the board views, which keep drag-to-transition
  against `available_transitions` only.

## Upstream

`td-2b4bc9` already proposes log and handoff write endpoints in `td serve`. A
status or `unstart` endpoint belongs in the same ask. When it lands, delete
`internal/tdstatus`, its route in `newMux`, the override branch in the edit
form, and the CLAUDE.md section describing it.
