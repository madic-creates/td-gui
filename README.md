# td-gui

A local web UI for [td](https://github.com/marcus/td), an issue tracker built
for work that gets handed from one session to the next. Agents and humans pass
tasks to each other through handoffs and reviews, and td keeps the record.

td-gui puts that backlog in a browser. It runs on your machine, talks to td's
own HTTP API, and shows the same thing the CLI would: the same issues, the same
review policy, and td's own wording whenever it refuses something.

![The issue list, grouped by status](docs/images/issue-list.png)

## What you can do with it

- **See the whole backlog at once.** Issues are grouped by status, starting
  with what is moving and ending with what is finished. You can sort by id,
  title, priority or last update, filter by status, and search the text.
- **Ask a real question, not just a search.** Start the search box with `?` and
  the rest of the line is a TDQ query, the same language boards are built on,
  so `?type = bug AND priority <= P1` narrows the list to exactly that. td
  parses the query and phrases any complaint itself.
- **Open an issue and see everything td knows about it.** Description,
  acceptance criteria, the latest handoff split into done, remaining, decisions
  and uncertain, the activity log, comments, dependencies, the current review,
  and which sessions touched it.
- **Read text that was written to be read.** Descriptions, acceptance criteria,
  comments and review reasons render as GitHub Flavored Markdown, so a fenced
  block is a code block and a nested list is nested, instead of a wall of
  backticks. One button in the header switches the whole app back to the source
  text when you want to copy it or check what td stored. The editor still holds
  the raw source, and raw HTML is never rendered as markup.
- **Move work along.** Start, request review, approve, reject, block, unblock,
  close and reopen, with a reason wherever td records one. You are only offered
  the transitions td reports as available.
- **Review the way td expects.** When you approve, td-gui asks who did the
  review: you independently, someone else, or you on your own work. You can
  also record a review without closing the issue.
- **Create and edit issues.** Type, priority, points, sprint, labels with
  autocomplete, parent, due date, defer date, and the minor flag.
- **Work from boards.** Any saved TDQ query, either as a flat backlog you can
  pin and reorder, or as swimlanes where dragging a card proposes a status
  change.
- **Let it keep itself current.** When an agent writes from the CLI in another
  terminal, the page follows along without a reload.
- **Know what you are running.** An About page names the project, the td-gui
  and td versions, the td binary in use and the backend it reached, and copies
  the lot as one block for a bug report.

It is a single binary with a light and a dark theme, its controls can be
reached from the keyboard, and nothing ever leaves `127.0.0.1`. One window per
project, each naming its own in the header and the browser tab.

## Quick start

Grab a binary from the
[latest release](https://github.com/madic-creates/td-gui/releases/latest)
(`td-gui-vX.Y.Z-linux-amd64`, with a `.sha256` next to it), or build one
yourself with `make build`. Then run it inside a td project:

```bash
td-gui
```

It picks a free port, starts `td serve` (or reuses a running one), and opens
your browser.

```bash
td-gui --port 7777        # fixed port
td-gui --no-open          # do not open a browser
td-gui --work-dir ../other-project
td-gui --td /path/to/td   # use a specific td binary
td-gui --version          # released binaries print their tag, local builds "dev"
```

**Requirements:** `td` **v0.57.0** or newer on your PATH, and a project you
have already run `td init` in. td-gui will not run `td init` for you.

## Documentation

| Page | What's in it |
| ---- | ------------ |
| [Getting started](docs/getting-started.md) | Starting it, the flags, what the connection dot means, sharing a backend with a running agent |
| [Working with issues](docs/issues.md) | The list, filters, sorting, ad-hoc TDQ queries, Markdown in long text, the detail page, creating and editing |
| [Transitions and reviews](docs/reviews.md) | The status flow, reasons, review attribution, why td sometimes refuses |
| [Boards](docs/boards.md) | Saved queries, the backlog view and pinning, swimlanes and drag-to-transition |

## How it works

td-gui never touches `.todos/issues.db`. It finds or starts td's own `td serve`
HTTP API and forwards everything to it, so each write passes through td's
migrations, action log and review policy, exactly as if you had typed the CLI
command yourself.

- Every listener binds to `127.0.0.1`, and the bearer token never appears in a
  response or in a log line.
- The frontend does not repeat any validation td already does. Title limits and
  review policy are per-project td settings, so td answers and the form shows
  you td's own message.
- The UI offers exactly the transitions td reports, and none at all when td
  reports none.

If a `td serve` is already running for the project, started by an agent or by
`td monitor`, td-gui reuses it and leaves it running when you quit. A backend
that td-gui started itself is also stopped by td-gui, and restarted once if it
dies unexpectedly.

## Development

```bash
make test                 # lint, then Go and frontend tests
make build                # web bundle into internal/web/dist, then the binary
make lint                 # golangci-lint, oxlint and tsc, without the suites
make typecheck            # tsc alone, the fastest check of a frontend edit
```

For hot reload against real data, run the server and the Vite dev server in two
shells:

```bash
td-gui --port 7777 --no-open
cd web && npm run dev
```

Conventions, invariants and the testing caveats are in
[CLAUDE.md](CLAUDE.md), which is worth reading before your first change. The
short version: the project is English only, the Go server uses the standard
library only, and a green `make test` can still hide a contract suite that
skipped itself because `td` was not on your PATH.

Design notes for each feature are in
[docs/superpowers/specs](docs/superpowers/specs).

## Releases

go-semantic-release cuts a release automatically whenever CI is green on
`main`. The commit subjects decide the version, so the Conventional Commit
scope described in [CLAUDE.md](CLAUDE.md) is what ships a release:

| Commit                                | Bump  |
| ------------------------------------- | ----- |
| `feat:`                               | minor |
| `fix:`, `perf:`, `refactor:`, `chore(deps):` | patch |
| any type with `!`                     | major |
| `docs:`, `test:`, `ci:`, `style:`     | none  |

The release job tags the commit, writes the changelog into the GitHub Release,
and attaches the `linux/amd64` binary together with its checksum. That binary
is built in the release job rather than reused from CI, because the tag has to
be compiled into it with `-ldflags -X main.buildVersion=`.

## License

td-gui is licensed under the Apache License 2.0; see [LICENSE](LICENSE).

It is an independent project and contains no code from td. It drives the `td`
binary and its HTTP API from the outside. td itself is a separate work by
Marcus Vorwaller, distributed under the MIT License.
