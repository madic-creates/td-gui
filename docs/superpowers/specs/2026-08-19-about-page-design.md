# An About page

A page at `/about`, reached from an ⓘ in the header, that answers where this
td-gui is pointed, what versions are running, and where the source lives.

## The problem

Every fact this page shows already exists at startup, and every one of them is
thrown away.

`run()` resolves the project directory into `baseDir`, locates the td binary,
and reads its version through `tdbin.Version` (`cmd/td-gui/main.go:65`). All
three are printed to stderr (`main.go:119`-`120`) and never referenced again.
`buildVersion` (`main.go:32`) is reachable only through `--version`, which
means the running process cannot tell you what it is. The browser is the only
place a user is actually looking, and it is the one place none of this reaches.

That costs three separate things:

- **Which instance is this?** td-gui is per-project, so several are routinely
  open at once. `web/index.html` hardcodes `<title>td-gui</title>`, and the
  header says `td-gui` too, so N windows are N identical tabs. Telling them
  apart means clicking into one and recognising the issues.
- **Diagnostics.** A bug report against td-gui wants the td-gui version, the td
  version, and which td — a Homebrew build, a `go install` build, a wrapper
  shim, or a `--td` override all behave differently. Today that means asking
  the reporter to run three commands.
- **Provenance.** Nothing in the UI says what this program is or where it comes
  from.

## The route: `/gui/about`

`/gui/` is the correct prefix and `internal/about` is a new package beside
`internal/tdquery`.

The existing `/gui/` route carries a warning that nothing should follow it out
of the proxy. That warning is about *subprocess reads of td's data*, and it
still stands: `/gui/about` runs no subprocess, opens no database, and reads
nothing of td's. It reports facts about the td-gui process itself, which is
exactly the category `/v1/` cannot contain — `/v1/` is td's API, proxied
wholesale, and td has no opinion about td-gui's build version.

The two `/gui/` routes therefore have opposite lifetimes, and the CLAUDE.md
section has to say so: `/gui/query` is scaffolding to delete when td serve
grows a query endpoint, `/gui/about` is permanent.

### What it answers

```go
// Info is fixed for the life of the process.
type Info struct {
	Project  string `json:"project"`   // baseDir, absolute
	TdGui    string `json:"td_gui"`    // buildVersion; "dev" outside a release build
	Td       string `json:"td"`        // tdbin.Version's answer
	TdPath   string `json:"td_path"`   // the located binary, after any --td override
	Go       string `json:"go"`        // runtime.Version()
	Platform string `json:"platform"`  // GOOS/GOARCH
	Source   string `json:"source"`    // repository URL
	License  string `json:"license"`   // "Apache-2.0"
}
```

The response nests the one part that is *not* fixed:

```json
{"ok": true, "data": {
  "project": "/home/you/proj", "td_gui": "dev", "td": "v0.57.0",
  "td_path": "/home/you/go/bin/td", "go": "go1.24.0", "platform": "linux/amd64",
  "source": "https://github.com/madic-creates/td-gui", "license": "Apache-2.0",
  "backend": {"url": "http://127.0.0.1:41234", "owned": true}
}}
```

`Manager.Owned()` flips from `false` to `true` when `Supervise` respawns a
backend that died, and `BaseURL()` changes with it. Everything above it in the
object is settled before the listener opens. Splitting them is not decoration:
it is the difference between a value the page may cache and one it may not, and
a flat object would hide that from the next reader.

The envelope is `{"ok":true,"data":{…}}` so `apiGet` unwraps it unchanged, and
a non-GET is a 405 — both matching `tdquery`.

### The handler does not take a `*Manager`

```go
type BackendState interface {
	BaseURL() string
	Owned() bool
}

func Handler(info Info, state BackendState) http.Handler
```

`*backend.Manager` already satisfies this, so `manager.go` is untouched. The
interface is declared here, at the consumer, which keeps `internal/about`
testable with a two-method fake and free of any dependency on the backend
package.

### The token invariant

The token is not in `Info`, and `BackendState` has no method that could reach
it — `Manager.Token()` exists but is not part of the interface, so the handler
cannot call it even by accident.

A test asserts the serialised body contains neither a fake's token value nor
the substring `token`. Not because today's struct is close to leaking one, but
because this is the first td-gui route that reports its own internals, and the
next field someone adds here is the one that would.

## The header

```
td-gui / my-project    ● connected  [▤ markdown] [◐ auto] [ⓘ] [Boards] [New issue]
```

`AppShell` calls `useAbout()` and renders the project's basename after the
existing `td-gui` link, muted, not itself a link. While the query is pending
the slot is simply empty — it is one word, and a skeleton for one word is
noisier than its absence.

The same effect sets `document.title` to `td-gui — my-project`, falling back to
`td-gui`. The tab strip is where windows are actually told apart, so this is
the larger half of the fix even though it is the smaller change.

Basename is split on `/[\\/]/`: `portfile_windows.go` exists, so Windows paths
reach this code.

### `useAbout()` refetches by mounting

One query, `queryKey: ['about']`, default staleness. `AppShell` mounts once and
fetches once. Navigating to `/about` mounts the page, which refetches, so the
backend block is fresh whenever it is on screen. No `staleTime` tuning, no
second query key, and no path by which the page shows a stale `owned`.

### ⓘ, not ?

The button is icon-only — the first in this header, where `ProseToggle` and
`ThemeToggle` both carry a label. Those two are toggles whose label states
*which side of the switch they are on*, which an icon cannot say. A link to a
page has no state to report, so the label would only repeat the icon.

The glyph is an ⓘ rather than a `?`. A `?` promises help or documentation in
nearly every application that has one, and this page has neither; sending a
user there for a version string is a small broken promise. It also draws worse:
`Icon.tsx` is a 16-box of `currentColor` strokes rendered at 12px, where a
question mark's bowl and tail close up into a blot, while a circle, a dot and a
stem stay separate.

Same border, padding and muted ink as its neighbours, `aria-label="About"` and
a matching `title`.

## The page

`features/about/AboutPage.tsx`, a definition list under an `About` heading:
project path, td-gui version, td version and path, Go and platform, backend URL
with `owned` rendered as `started by td-gui` or `existing instance`, source link
and license.

`CopyButton` on the project path — it is the field most likely to be pasted
into a terminal. A second **Copy diagnostics** button puts the whole set on the
clipboard as a Markdown block ready for a GitHub issue; that button is the
actual deliverable of the diagnostics case, since the alternative is the
reporter transcribing six fields by hand.

The source link is `target="_blank"` with `rel="noopener noreferrer"`.

`<Route path="/about" element={<AboutPage />} />` in `App.tsx`, inside the
existing `ErrorBoundary`.

## Why a route and not a popover

A popover would be the only one in the codebase: positioning, outside-click
dismissal, Escape, and focus return, all new, all needing tests, for one
surface. A route reuses routing, the error boundary and the existing page test
patterns, and adds no dismissal logic at all — the browser's Back button is the
dismissal. The glanceable half of the problem is solved by the header and the
tab title, which is what left the page free to be a page.

`BoardTransitionPanel` is the house's inline-`role="dialog"` pattern and was
the alternative considered. It is right for something that must not lose the
board underneath it. About has nothing underneath worth preserving.

## Tests

Go, `internal/about`:

- `GET` returns every field, with `owned` in both states from a fake.
- Non-GET is a 405.
- The body contains neither the fake's token nor the substring `token`.
- `newMux` routes `/gui/about` (alongside the existing route assertions).

Frontend:

- `AboutPage.test.tsx` — fields render, `owned` maps to both wordings, the
  copy-diagnostics payload contains the versions and the path.
- `AppShell.test.tsx` extended — the basename appears in the header, the ⓘ
  links to `/about`, and `document.title` is set. Existing assertions stay.

## Documentation to amend

- `CLAUDE.md`, the `/gui/` section: it currently reads as though `/gui/query`
  is the only route the prefix will ever hold, and its deletion instruction has
  to stop covering `/gui/about`.
- `cmd/td-gui/main.go:138`: "the three things td-gui serves" is now four.

## Not in scope

No update check, no license text, no dependency list, no live refresh of the
backend block while the page is open — the connection dot already reports
liveness, and a second live indicator would be a second thing to keep honest.
