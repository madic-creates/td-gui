# Getting started

## Before you start

td-gui needs two things:

- **`td` v0.57.0 or newer** on your PATH (or passed with `--td`). Older
  releases have `td serve`, but not the `available_transitions` and
  `active_review` fields the UI is built on.
- **A project that has already been initialised.** td-gui refuses to start in a
  directory without `.todos`, and it will not run `td init` for you:

  ```
  td-gui: /home/you/project is not a td project (no .todos directory) — run `td init` there first
  ```

## Starting it

From inside the project:

```bash
td-gui
```

It picks a free port, brings up the backend, prints where everything is, and
opens your browser:

```
td-gui is running on http://127.0.0.1:46279
  project:  /home/you/project
  td:       /usr/local/bin/td (v0.57.0)
  backend:  http://127.0.0.1:41113 (started by us)
```

Press `Ctrl-C` to stop. Everything td-gui started, it also stops.

### Flags

| Flag | Meaning |
| ---- | ------- |
| `--port N` | Serve the UI on a fixed port instead of a free one. Fails loudly if the port is taken. |
| `--no-open` | Do not launch a browser. |
| `--work-dir DIR` | Which project to open. Defaults to the current directory. |
| `--td PATH` | Use a specific td binary instead of the one on PATH. |
| `--version` | Print the version and exit. Released binaries print their tag; anything you built yourself prints `dev`. |

## Sharing a backend with an agent

The line that says `backend:` tells you what happened underneath.

- **`(started by us)`** — no usable `td serve` was running, so td-gui started
  one with a random bearer token on a random port. It supervises that process
  and restarts it once if it dies unexpectedly. A backend that dies twice is
  failing for a reason td-gui cannot fix, so it stays down and the UI shows its
  disconnected banner rather than pretending.
- **`(existing instance)`** — a `td serve` was already running for this project
  (an agent, or `td monitor`), and td-gui reused it. That instance is not
  td-gui's to stop, so it keeps running after you quit.

If a foreign instance is running with a bearer token td-gui does not know, it
refuses to start rather than guess:

```
td-gui: a td serve instance is already running on port 41113 with a bearer
token td-gui does not know; stop it, or start td-gui against a different project
```

To work on two projects at once, run one td-gui per project — each with its own
`--work-dir` and, if you want stable bookmarks, its own `--port`.

## Staying current

The header carries a dot: green `connected`, amber `disconnected`.

td-gui subscribes to td's server-sent event stream, and td broadcasts whenever
anything changes — including changes made from the CLI in another terminal. So
when an agent logs progress or closes an issue while you are looking at it, the
page catches up on its own. There is no reload button because there is nothing
to reload.

When the connection drops, a banner appears under the header:

> Backend disconnected — the data shown may be out of date.

The page keeps rendering the last data it had. The browser reconnects on its
own; the banner disappears when it succeeds.

## Theme

The button next to the connection dot cycles **auto → light → dark**. `auto`
follows your operating system. The choice is stored in your browser, per
device.

## Security

td-gui is a local tool and its boundaries are deliberate:

- Every listener binds `127.0.0.1`, never `0.0.0.0`. Nothing is reachable from
  the network, and the UI is not something to expose with a reverse proxy.
- Requests from another origin are rejected, so a random page in another tab
  cannot drive your backlog.
- The bearer token used to reach `td serve` never appears in a response body, a
  response header, or a log line.

## When something goes wrong

| Message | What it means |
| ------- | ------------- |
| `... is not a td project (no .todos directory)` | Wrong directory, or the project was never initialised. Run `td init` there yourself. |
| `td vX.Y.Z is too old, v0.57.0 or newer is required` | Upgrade td, or point `--td` at a newer binary. |
| `td binary not found in PATH — install td or set --td` | td is not on PATH. |
| `port N is already in use` | Something else holds the port you asked for. Drop `--port` to let td-gui pick one. |
| ``no web build embedded (run `make web`) — this binary contains no web build`` | A Go binary built without the frontend bundle. Use `make build`, not bare `go build`. |
| `td serve did not become reachable within 15s` | The backend started but never answered. Its stderr is passed through to your terminal — read that first. |

Errors that come from td itself — validation, review policy — are shown in the
UI exactly as td phrased them. That wording is the authoritative explanation;
td-gui does not rewrite it.
