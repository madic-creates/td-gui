# td-gui

Always check if you are running in Sidecar: run sidecar --agents for capabilities.

## What this repository is

td-gui is a local web UI for [td](https://github.com/marcus/td), an issue
tracker built for work that is handed from one session to the next: agents and
humans pass tasks to each other through handoffs and reviews, and td keeps the
record. This repo dogfoods td on itself, so `.todos/` at the root is real
project state, not a fixture.

It ships as **one binary**: a Go server with the React single-page app embedded
in it. The server does not implement an issue tracker. It finds or starts td's
own `td serve` HTTP API and reverse-proxies to it, so the browser is really
talking to td, and every write passes through td's migrations, action log and
review policy. Two reads and one write run td's CLI instead, because td serve
has no route for what they do; they are named and fenced below.

Two things this implies, and they explain most of the design:

- td-gui owns **presentation**, td owns **truth**. Validation limits, available
  transitions, review attribution rules and error wording all come from td over
  the wire; the frontend renders the answer instead of predicting it.
- td-gui is a **client of a CLI tool it does not control**. Where td's interface
  is awkward (no query endpoint, no status endpoint, token only as a flag), the
  workaround is documented and fenced in rather than hidden. See the
  "deliberately" sections below.

Runtime requirements: `td` v0.57.0 or newer on `PATH` (the minimum is pinned as
`minTdVersion` in `cmd/td-gui/main.go` and checked at startup), plus a project
someone has already run `td init` in. td-gui refuses rather than initialising
one.

`README.md` and `docs/` describe what the app does from a user's point of view;
read those for feature behaviour. This file is about how the code is built and
what must not change.

## How a request flows

```
browser
  -> td-gui listener            127.0.0.1, free port or --port
     -> OriginGuard             rejects a foreign Origin/Referer
        -> mux
           /v1/, /health  -> reverse proxy -> td serve   (token injected here)
           /gui/query     -> `td query` subprocess       (exception, read)
           /gui/status    -> `td unstart`/`td update`    (exception, write)
           /gui/about     -> this process's own versions and paths
           /              -> embedded SPA, index.html fallback for client routes
```

The browser never sees the bearer token: the proxy strips any client-supplied
`Authorization` header and sets its own. Live updates ride td's SSE stream at
`/v1/events`; the proxy flushes unbuffered so the stream is not swallowed, and
the SPA invalidates its whole query cache on each `refresh` event rather than
applying deltas.

If a `td serve` is already running for the project (an agent, `td monitor`),
td-gui probes it and reuses it, and leaves it running on exit. A backend td-gui
started itself is stopped by td-gui, and restarted once if it dies. A restart
means a new port and a new token, so the proxy handler is hot-swapped behind
`proxy.Switch` instead of rebuilding the listener, which would drop the SSE
connection.

Loopback is not a boundary against the browser: any page can call localhost,
so `OriginGuard` checks `Origin`/`Referer` and lets header-less non-browser
clients through, since those could run the td CLI anyway.

## Repository map

| Path | What lives there |
| ---- | ---------------- |
| `cmd/td-gui/main.go` | Flags, startup order, the version gate, `newMux`, listener, browser open, shutdown |
| `internal/tdbin` | Locating the td binary and parsing/comparing `td --version` |
| `internal/backend` | `.todos/serve-port` discovery, probing an existing instance for reuse, spawning and supervising our own |
| `internal/proxy` | Reverse proxy with token injection and SSE-safe flushing, `Switch` for restarts, `OriginGuard` |
| `internal/tdquery` | `GET /gui/query`, a read that shells out instead of proxying |
| `internal/tdstatus` | `POST /gui/status`, the one write that shells out, for the three status jumps td serve cannot express |
| `internal/about` | `GET /gui/about`, td-gui's own versions, paths and backend state |
| `internal/web` | `go:embed` of the Vite bundle and the SPA fallback handler |
| `test/contract` | End-to-end against a **real** td binary; skips itself when td is absent |
| `web/src/api` | Typed client (`ApiError` carries td's code, message and field errors), TanStack Query hooks, the SSE hook |
| `web/src/features/issues` | Issue list, filters, detail, forms, transitions, review panel |
| `web/src/features/boards` | Saved TDQ boards: backlog view with pinning, swimlanes with drag-to-transition |
| `web/src/components`, `web/src/lib` | Shared UI (Markdown, prose toggle, tags, error panels) and helpers (theme, formatting) |
| `docs/` | User documentation; `docs/superpowers/specs` holds per-feature design notes, which are history, not usage docs |

Stack: Go standard library only on the server. React 19, react-router,
TanStack Query, Tailwind 4, Vite, TypeScript on the frontend, tested with
Vitest and Testing Library. Tests sit next to the code they cover, as
`*_test.go` and `*.test.ts(x)`.

## Language: English only

**English is the only language of this project** — UI strings, CLI output,
code, comments, commit messages, docs, and td issue text.

This project is **not** multilingual: do not introduce an i18n layer, a
locale switcher, or translated fallbacks. An earlier revision hardcoded the
UI in German and that decision was deliberately reversed, so German in the
git history is not precedent.

### The one exception: messages that come from td

Error text produced by `td serve` is displayed **verbatim**, never rewritten
or translated:

- Validation errors — `title too short (2 chars, min 15)`
- Review-policy rejections — `you implemented this issue, so you cannot approve it`

td phrases these precisely and its wording is authoritative. Replacing them
with our own strings would make the GUI strictly worse than the CLI. Tests in
`web/src/api/client.test.ts` and `web/src/features/issues/IssueDetail.test.tsx`
pin this behaviour — keep them green.

## Architecture invariants

These are load-bearing; changing them changes what td-gui is.

- td-gui **never** opens `.todos/issues.db` and never runs `td init`. Every
  write goes through `td serve` — with one fenced exception, `/gui/status`,
  which runs td's own CLI because td serve has no route for it. Either way the
  write is td's own code, so its migrations, action log and review policy stay
  intact.
- All listeners bind `127.0.0.1` only, never `0.0.0.0`.
- The bearer token must never appear in a response body, a response header,
  or a log line. It **is** visible in the process table — see below.
- The frontend never validates against hardcoded field limits. Title length
  and similar bounds are per-project td config — the server validates and the
  form displays the server's answer.
- Transitions go through td's own endpoints (`start`, `review`, `approve`, …),
  never a raw status PATCH — there is no such thing, td serve ignores a
  `status` field silently. The UI renders exactly the transitions td reports
  in `available_transitions`, and renders none when the field is absent. The
  three jumps td reports no transition for go through `/gui/status`; see
  below.

### Two routes run `td` instead of proxying — deliberately

Both are under `/gui/`, both shell out, and both leave when td serve grows the
endpoint they stand in for. One reads, one writes.

#### `/gui/query` — the read

`internal/tdquery` answers `GET /gui/query?q=<tdq>` by running `td query` as a
subprocess, rather than going through `td serve`.

This is td's interface, not our choice: `td serve` v0.57.0 exposes no query
route at all. `/v1/query` is a 404, and `/v1/issues` ignores an unknown `q`,
`query`, `tdq` or `filter` parameter rather than rejecting it, so a TDQ
expression sent there silently returns the full, unfiltered list. TDQ lives in
the CLI.

The invariant above holds literally: no database is opened, no `td init` is
run, and every write still goes through `td serve`. A query is a read through
td's own binary, which owns the grammar and phrases the failure. It is still a
departure from the spirit of the rule, so it is fenced in:

- The route is `/gui/`, never `/v1/`. That prefix is td's API, proxied
  wholesale; `/gui/` says honestly which half of the surface a caller is on,
  and marks exactly what gets deleted.
- The handler returns ids, not issues. `td query -o json` is a lossy subset of
  the API's issue shape, and the frontend joins the ids against the index it
  already holds rather than carrying a second issue shape.
- The query reaches td as one argv element behind a `--`, with no shell. The
  separator is load-bearing: without it td's flag parser claims a query of
  `--help` and prints its help text on stdout with exit 0.

When td serve grows a query endpoint (td-894042 upstream), switch to it and
delete `internal/tdquery`, the route in `newMux`, and this section.

#### `/gui/status` — the write

`internal/tdstatus` answers `POST /gui/status` by running `td unstart` or
`td update --status` as a subprocess. It is the only write in td-gui that does
not go through `td serve`.

This is td's interface, not our choice. td serve v0.57.0 has no route that
sets a status: `POST /v1/issues/{id}/unstart` is a 404, and
`PATCH /v1/issues/{id}` answers `ok` while silently ignoring a `status` field —
no error, no change. Three moves therefore have no API at all:

| From | Target with no transition |
| ---- | ------------------------- |
| `in_progress` | `open` |
| `in_review` | `in_progress` |
| `blocked` | `in_progress` |

Everything else still goes through td's transition endpoints, and the edit
form picks between the two by reading `available_transitions` — never from a
status graph of its own.

The fencing mirrors `tdquery`'s, plus what a write needs:

- The route is `/gui/`, never `/v1/`, and it requires POST.
- The status is validated against td's five before anything spawns. That is
  the one value reaching td's argv as a flag argument, and it is not a
  prediction of td's answer: which jumps are legal stays td's to refuse, in
  td's own words. The five combinations td rejects are offered by the UI and
  refused by td, not greyed out from a table here.
- The id reaches td as one argv element behind a `--`, with no shell, for the
  reason `tdquery` documents.
- `td unstart` is preferred when the target is `open` because it is the only
  command that records the move (`Reverted to open` in the session log) — but
  it reverts from `in_progress` alone, so a refusal falls back to
  `td update --status open`. A refusal wrote nothing, which is what makes the
  fallback the first write rather than a second one.
- td exits 0 whether it applied the change or refused it, and a refusal under
  `--json` is silent on both streams. So the plain form runs, and the streams
  decide: stdout confirms, stderr refuses, and silence on both is neither and
  is reported as a failure.

`test/contract` pins all twenty jumps against a real td, because the shape of
that matrix is td's to change: `td update --status` enforces its own rules,
wider than `available_transitions` but not by much.

Nothing else follows these two out of the proxy. When td serve grows a status
or unstart endpoint (`td-2b4bc9` proposes it upstream), switch to it and
delete `internal/tdstatus`, the route in `newMux`, the override branch in
`statusChange.ts`, and this section.

### `/gui/about` is the other kind of `/gui/` route

`internal/about` answers `GET /gui/about` with what this td-gui process is:
project directory, td-gui and td versions, the located td binary, Go and
platform, source and license, plus the live backend URL and whether we started
it.

It shares the prefix with those two and nothing else. It runs no
subprocess, opens no database and reads nothing of td's — every value is
either a constant or something `run()` already resolved at startup and used to
print to stderr. The routes have opposite lifetimes: `/gui/query` and
`/gui/status` are scaffolding to delete, `/gui/about` is permanent, because
td will never have
an opinion about td-gui's own build version. That is also why it cannot live
under `/v1/`.

The token stays out of it structurally, not by care: the handler takes an
`about.BackendState` interface naming only `BaseURL()` and `Owned()`, so the
`*backend.Manager` it is handed arrives with `Token()` out of reach. A test
asserts the response body contains neither a token value nor the word. Keep
both — this is the one route that reports td-gui's own internals, so it is
where a leak would come from.

### The token is visible in `ps` — deliberately

`internal/backend/manager.go` spawns the backend as `td serve … --token
<token>`, and `/proc/<pid>/cmdline` is world-readable unless procfs is mounted
with `hidepid`. Any local account can read the token out of `ps -ef`.

This is td's interface, not our choice: `td serve` accepts the token only as a
flag — no `--token-file`, no `--token-fd`, no environment variable. td-gui
cannot close this alone.

We accept it, because of what the token actually buys an attacker:

- `td serve` binds loopback, so the attacker already needs a local account.
- `.todos/issues.db` is mode 0644, so they can already read every issue, and a
  process running as *you* can already write it directly.
- What the token adds is API write access for a *different* local account,
  logged against td-gui's session rather than theirs.

The residual risk is a compromised unprivileged daemon laundering writes
through our session. Do not paper over it with a side channel: if td ever
gains `--token-file`, `--token-fd` or an environment variable, switch to it
and delete this section.

## Build and test

```bash
make test      # lint, then go test ./... and the frontend suite
make build     # web bundle into internal/web/dist, then the Go binary
make lint      # golangci-lint, oxlint and tsc, without the suites
make typecheck # tsc -b alone, the fastest check of a frontend edit
```

`make test` lints first, so it needs `golangci-lint` (v2) installed — a
lint failure stops the run before any test executes. `pre-commit install`
wires the same checks plus whitespace/EOL fixers into the commit hook.

`lint` includes the TypeScript typecheck because nothing else reads types:
golangci-lint compiles the Go and so typechecks it for free, but oxlint does
not type, and vitest transpiles through esbuild, which strips types without
checking them. Before `make typecheck` existed, `make test` passed on a tree
`make build` could not compile, and a commit that broke the build reached
main that way.

**A green `make test` can be misleading.** `test/contract` drives a real `td`
binary and skips itself when `td` is not on PATH — `go test ./...` still
prints `ok` for the package. The contract is only actually verified with `td`
v0.57.0+ installed; check for `--- SKIP` before trusting a green run.

Frontend commands run from `web/`. Bare `npm test` watches in an interactive
terminal (it runs once and exits without a TTY), so prefer the explicit
`npm test -- --run`, optionally with a filename filter. Single Go test:
`go test ./internal/backend/ -run TestSuperviseRestartsOnce`.

`make web` must keep `internal/web/dist/.gitkeep` — Vite's `emptyOutDir`
deletes it, and `go:embed` needs it to compile on a fresh checkout with no
web build. The Makefile restores it; do not remove that step.

The Go server uses the standard library only — no web framework, no router
library, no CLI framework.

## Commits

Conventional Commits with a scope matching the package:
`feat(backend):`, `feat(web):`, `test:`, `docs:`, `refactor:`.
