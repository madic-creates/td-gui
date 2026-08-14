# td-gui — Project Conventions

## Language: English only

**English is the primary and only language of this project.** This applies to:

- User-facing UI strings in the web frontend
- CLI output: flag help, startup banner, error messages
- Code, identifiers, comments and doc comments
- Commit messages, README and documentation
- Issue titles and descriptions in td

This project is **not** multilingual and no i18n layer should be introduced.
An earlier revision hardcoded the UI in German; that decision was reversed.
If a string is user-visible, it is English — do not add a translation
mechanism, a locale switcher, or German fallbacks.

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
make test     # go test ./... plus the frontend suite
make build    # web bundle into internal/web/dist, then the Go binary
```

`make web` must keep `internal/web/dist/.gitkeep` — Vite's `emptyOutDir`
deletes it, and `go:embed` needs it to compile on a fresh checkout with no
web build. The Makefile restores it; do not remove that step.

The Go server uses the standard library only — no web framework, no router
library, no CLI framework.
