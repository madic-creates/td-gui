# Documentation screenshots from a seeded demo project

## The problem

The nine images under `docs/images` were shot against td-gui's own backlog.
That has two costs. They drift: `issue-new.jpg` still shows the four-field
create form that td-e38efb replaced, and td-3765ea records why it was left
behind — regenerating it "needs the app running and a project with enough
issues for the parent picker to look real". And they are unreproducible: the
backlog they were shot against no longer exists in that shape.

Screenshots of the project's own issues also read ambiguously. A reader cannot
tell whether `td-885e52 "Add drag feedback to the backlog view"` is
illustration or the actual state of the tool they are about to run.

## The shape of the fix

Seed a throwaway td project with data chosen to exercise every claim the docs
make, shoot all nine images against it, and commit the seeder so the next
regeneration is one command plus a browser.

The demo project is **Shoebox**, a self-hosted photo library. It is invented,
so nothing about it can go stale, and it is far enough from td-gui that no
reader mistakes it for this repo's backlog. English only, like everything else
here — the seeded issues are project text and the rule in
[CLAUDE.md](../../../CLAUDE.md) applies to them.

## The data

Roughly twenty issues, picked so that each doc claim has something to show.

| What the docs claim | What the seed provides |
| ------------------- | ---------------------- |
| Five status buckets in attention order | `in_progress`, `open`, `in_review`, `blocked`, `closed` all non-empty |
| Sorting by id, title, priority, updated | P0–P3 and all five types spread across the set |
| An epic lists its direct children | `Album sharing links`, an epic with three tasks |
| The sidebar omits unset rows | one issue with points, labels, sprint, parent, due, defer all set; others with almost none |
| A handoff, split four ways | one issue carrying done, remaining, decisions and uncertain |
| Activity tagged by kind | `progress`, `decision` and `blocker` entries |
| Dependencies, with resolved ones split out | one issue waiting on two others, one of them already closed, and blocking a third |
| The review panel hides superseded entries | reject → resubmit → `approve --record-only`, leaving two reviews on an issue still in review |
| A `self-reviewed` marker | one closed issue approved with `--self-review` |
| Label autocomplete suggests used labels | eight labels reused across the set |
| Implementer, reviewer and closing sessions differ | `td session --new` between seeding blocks |

Boards: td's builtin *All Issues*, plus two of our own with real TDQ queries,
one of which has three cards positioned via `td board move` so the backlog view
has both a **Pinned** block and a query-ordered one.

## Seeding

`docs/screenshots/seed.sh <dir>` wipes and recreates the target directory,
runs `git init` and `td init`, then drives the `td` CLI for everything else.

It goes through the CLI for the same reason td-gui goes through `td serve`: td
owns its migrations, action log and review policy, and a seeder that wrote
`issues.db` directly would produce a database td never would. That also makes
the review and session attribution real rather than staged — the reason for
`td session --new` between blocks is that td refuses to let a session approve
its own work, and the seed wants that refusal to be satisfied honestly.

Every date is relative (`+9d`, `-2d`), so a seed run in a year produces the
same picture rather than a wall of overdue issues.

## Shooting

A 1400 px viewport, dark theme forced by setting
`localStorage['td-gui.theme'] = 'dark'` before first paint, each image clipped
to its own region of the page.

Two shots need an interaction rather than a URL — **Edit** for `issue-edit`,
**Approve** for `issue-review` — `issue-activity` is a region further down the
detail page, and `issue-new` is filled in, because an empty form shows that the
fields exist but not what any of them takes. The board views are reachable
directly as `?view=backlog` and `?view=swimlanes`.

This was planned as a written recipe rather than a script, on the grounds that
nine screenshots do not justify maintaining a driver. That turned out to be the
wrong way round. A real browser window cannot be held at 1400 px — the window
manager ignores the requested size, and the extension's viewport is fixed at
1229 — so the shots have to come from a headless Chromium driven over the
DevTools protocol. Once that driver exists, committing it costs nothing and
makes the whole regeneration two commands, so `docs/screenshots/shoot.mjs` is
part of the change.

Its anchors are text lookups rather than class names: the classes are Tailwind
utilities and would break on any styling edit.

The images are PNG rather than the previous JPEG. Measured on these nine, PNG
is both smaller and lossless — flat-colour UI text is what JPEG handles worst.
That does mean the ten Markdown references change, which is the one edit to the
prose files this otherwise avoids.

## Out of scope

The prose in `README.md` and `docs/*.md` is not revised — only the image paths
in it, for the format change. This changes what the images show, not what the
documentation says.
