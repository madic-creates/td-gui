# Regenerating the documentation screenshots

The nine images in [../images](../images) are shot against a seeded demo
project, not against td-gui's own backlog. Two scripts do it:

```bash
docs/screenshots/seed.sh /tmp/shoebox                       # build the demo project
./td-gui --work-dir /tmp/shoebox --port 7777 --no-open &    # serve it
node docs/screenshots/shoot.mjs http://127.0.0.1:7777 docs/images
```

`make build` first, so the binary serves the current frontend — `shoot.mjs`
photographs whatever the Go binary has embedded, not what is in `web/src`.

Requires `chromium` on PATH, node 22 or newer, and `td` v0.57.0+.

## What the two scripts do

**`seed.sh`** creates *Shoebox*, an invented self-hosted photo library, with
about twenty issues spread across every status. It deletes and recreates its
target directory, and refuses to touch a directory it did not create itself.

Everything goes through the `td` CLI, never through `issues.db` — td owns its
migrations, action log and review policy, and a hand-written database would
produce a state td never would. The `td session --new` calls are load-bearing:
td refuses to let a session approve its own work, so they are what makes the
implementer, reviewer and creator on the detail page three different sessions.

**`shoot.mjs`** drives a headless Chromium over the DevTools protocol. It is
headless and CDP-driven because the images have a fixed geometry — 1400 px
wide, dark theme, each clipped to a named region — and a window manager will
not honour a requested window size, which rules out photographing a real
browser window.

It reads the issue and board ids off the running instance, so a fresh seed with
different ids needs no edit here.

## The nine images

| Image | Where it comes from |
| ----- | ------------------- |
| `issue-list` | `/`, whole page |
| `issue-detail` | the hero issue, down to the Activity heading |
| `issue-activity` | the same page, Activity through Comments |
| `issue-review` | the same page after clicking **Approve** |
| `issue-edit` | the same page after clicking **Edit** |
| `issue-new` | `/new`, filled in and with the parent suggestion accepted |
| `board-list` | `/boards` |
| `board-backlog` | the *Current work* board, `?view=backlog` |
| `board-swimlanes` | the same board, `?view=swimlanes` |

The hero issue is *Thumbnail generation blocks the upload response*: it is the
one seeded with a four-part handoff, activity of three kinds, two comments from
different sessions, a resolved and an unresolved dependency, and a review
history with a superseded entry.

Anchors are text lookups (`Activity`, `Approve`, `Add label`) rather than class
names, because the classes are Tailwind utilities that change with any styling
edit.

## Two things worth knowing before you re-shoot

**Every timestamp reads the same.** The seed writes all twenty issues within a
few seconds, so the relative times are uniform — "just now" if you shoot
immediately, "6m ago" everywhere if you shoot six minutes later. The old images
showed a plausible spread of "3m ago / 19m ago" only because they were taken
against a backlog that had been worked in for weeks. td owns `updated_at`, so
producing a spread would mean writing `issues.db` directly, which is the one
thing neither script does. Letting a few minutes pass before shooting at least
avoids a wall of "just now".

**PNG, not JPEG.** Measured on these images, PNG is both smaller and lossless —
flat-colour UI text is the case JPEG handles worst. `shoot.mjs` writes PNG
directly; there is no conversion step.

## Changing the demo data

Edit `seed.sh`, then re-seed into a fresh directory and re-shoot. Two traps,
both already commented in the script:

- td cascades a parent to closed once **all** its children are complete, so
  every child of an epic has to exist before the first one is closed.
- `td reject` moves the issue and writes a log entry but records no review, so
  the superseded entry in the review panel needs an explicit
  `td approve --record-only --decision changes_requested`.

The design behind all of this is in
[../superpowers/specs/2026-08-17-documentation-screenshots-design.md](../superpowers/specs/2026-08-17-documentation-screenshots-design.md).
