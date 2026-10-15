# Activity page at `/activity`: recent activity and agent sessions

td issue: td-8939b4
Date: 2026-10-15

## Problem

td-gui shows issues one at a time or as lists, but nothing answers "what has
happened in this project lately, and who did it". On the CLI, `td monitor`
answers that; in td-gui there is no equivalent. Work in a td project is spread
across many agent sessions, and the only way to follow it today is to open
issues one by one and read their logs.

tdb (github.com/jubishop/tdb, another browser front end for td) has an
Activity view with two columns, a feed of recent events and a list of agent
sessions. This is that view for td-gui.

## What the data actually looks like

Measured against a real project (`game`, td v0.66.0), not assumed:

- `GET /v1/monitor` returns `data.monitor.activity`, an array of the **50**
  most recent events, newest first. td picks the 50; td serve takes no
  parameter to page or filter them.
- Each event carries `timestamp`, `session_id`, `type` (`action`, `log`,
  `comment`), `action`, `log_type`, `message`, `issue_id`, `issue_title` and
  `entity_type`.
- `issue_id` is **not always an issue id**. For `create` it is a log id
  (`lg-…`), for `handoff` a handoff id (`ho-…`), for `link_file` a file-link
  id (`ifl_…`). In exactly those cases `issue_title` is empty. Whenever the id
  is an issue, td fills `issue_title`.
- `GET /v1/sessions` returns `data.sessions`; this project has **165**, most of
  them weeks old. Each has `id`, `name` (often empty), `agent_type` (for
  example `claude-code_411842`, `unknown`, `web`), `branch` and
  `last_activity`.
- Both routes already pass through td-gui's `/v1/` proxy unchanged.

## Design

### Data

Two hooks in `web/src/api/queries.ts`:

- `useMonitor()` fetches `GET /v1/monitor`. The page reads only
  `monitor.activity`.
- `useSessions()` fetches `GET /v1/sessions`.

Types `ActivityItem`, `Session`, `MonitorResponse` and `SessionsResponse` go in
`web/src/api/types.ts`, declaring only the fields the page reads.

Live updates need no new code. `useLiveUpdates` invalidates the whole query
cache on every `refresh` event, so both queries refetch whenever anyone writes.

No Go changes. Both routes are td's own and already proxied, so there is no
new `/gui/` route and none of the architecture invariants in CLAUDE.md move.

### Linking an event to its issue

An event links to `/issues/:id` **only when td sent a non-empty
`issue_title`**. td sets the title only when the id resolves to an issue, so
td decides what is an issue, not a pattern such as `td-*` in our code. Events
without a title render as plain text ("created issue", "handoff").

### Layout

- `AppShell.tsx` gets an **Activity** link left of *Epics*, styled like it.
  `App.tsx` gets the route `/activity`.
- `web/src/features/activity/ActivityPage.tsx`: heading "Activity", then two
  columns, the feed wide and the sessions narrow. Below roughly 900px they
  stack. The view owns its padding and sets no width cap, as the `AppShell`
  comment requires.
- `ActivityFeed.tsx`: heading "Recent activity". Each entry shows the session
  label, `relativeTime(timestamp)` with the exact timestamp as a tooltip,
  td's `message` verbatim, the issue title as a link when present, and the
  `log_type` as a tag when present (`progress`, `decision`, `blocker`). An
  empty feed shows `EmptyState`.
- `SessionList.tsx`: heading "Agent sessions" with the total count, and the
  note "Last recorded activity, not process health", since td records when a
  session last wrote, not whether its process is alive. Sessions sort by
  `last_activity`, newest first. The first **20** show; a "Show all (N)"
  button reveals the rest. That choice is per visit and not persisted. With
  20 or fewer there is no button. Each card shows the label, the session id,
  the branch and "Seen <relative time>".

### Session labels

One function, `sessionLabel(session)` in `features/activity/`, decides what a
session is called: `name`, else `agent_type`, else `shortSession(id)`.

The feed looks `session_id` up in the sessions list. When the session is not
there (the list is still loading, it failed, or td does not list it), the
feed shows `shortSession(session_id)`.

### Errors and loading

Each column handles its own query. Loading shows `SkeletonRows`, failure
shows `ErrorPanel` with td's message verbatim. A failing `/v1/sessions` does
not take the feed down with it, and the reverse.

### Left out

Counters (in progress / to review / blocked), feed filters, loading more than
td's 50 events, keyboard shortcuts. None was asked for, and the third has no
API to stand on.

## Testing

Next to the code, following `EpicList.test.tsx`:

- `ActivityFeed.test.tsx`: an event with `issue_title` links to
  `/issues/<id>`; events with `lg-…`, `ho-…`, `ifl_…` ids and no title render
  as text; `message` appears verbatim; `log_type` renders as a tag; empty
  feed shows `EmptyState`; an error shows `ErrorPanel` with td's text.
- `SessionList.test.tsx`: sorted by `last_activity`; more than 20 sessions
  show exactly 20 plus "Show all (N)", which reveals the rest; 20 or fewer
  show no button.
- `sessionLabel.test.ts`: `name`, then `agent_type`, then the short id.
- `ActivityPage.test.tsx`: with `/v1/sessions` failing, the feed still
  renders, labelled with short session ids.
- `AppShell.test.tsx`: the Activity link exists and points at `/activity`.
- `test/contract`: against a real td, `/v1/monitor` returns a
  `monitor.activity` array and `/v1/sessions` a `sessions` array. This pins
  the shape we depend on, which is td's to change.

## Documentation

`docs/activity.md` describes the page, linked from `docs/README.md` and the
documentation list in `README.md`.
