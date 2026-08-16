# td-gui — Project Conventions

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
  write goes through `td serve`, so td's migrations, action log and review
  policy stay intact.
- All listeners bind `127.0.0.1` only, never `0.0.0.0`.
- The bearer token must never appear in a response body, a response header,
  or a log line.
- The frontend never validates against hardcoded field limits. Title length
  and similar bounds are per-project td config — the server validates and the
  form displays the server's answer.
- Transitions go through td's own endpoints (`start`, `review`, `approve`, …),
  never a raw status PATCH. The UI renders exactly the transitions td reports
  in `available_transitions`, and renders none when the field is absent.

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
