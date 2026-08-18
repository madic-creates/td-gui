# Getting started

## Before you start

td-gui needs two things:

- **`td` v0.57.0 or newer** on your PATH, or passed with `--td`. Older releases
  do have `td serve`, but they do not report the `available_transitions` and
  `active_review` fields that the UI is built on.
- **A project you have already initialised.** td-gui refuses to start in a
  directory without a `.todos` folder, and it will not run `td init` for you:

  ```
  td-gui: /home/you/project is not a td project (no .todos directory) — run `td init` there first
  ```

## Starting it

Run it from inside the project:

```bash
td-gui
```

td-gui picks a free port, brings up the backend, prints where everything is
listening, and opens your browser:

```
td-gui is running on http://127.0.0.1:46279
  project:  /home/you/project
  td:       /usr/local/bin/td (v0.57.0)
  backend:  http://127.0.0.1:41113 (started by us)
```

Press `Ctrl-C` to stop it. Whatever td-gui started, it also shuts down again.

### Flags

| Flag | Meaning |
| ---- | ------- |
| `--port N` | Serve the UI on a fixed port instead of a free one. Fails loudly if the port is taken. |
| `--no-open` | Do not launch a browser. |
| `--work-dir DIR` | Which project to open. Defaults to the current directory. |
| `--td PATH` | Use a specific td binary instead of the one on PATH. |
| `--version` | Print the version and exit. Released binaries print their tag; anything you built yourself prints `dev`. |

## Sharing a backend with an agent

The `backend:` line tells you what happened underneath.

- **`(started by us)`** means no usable `td serve` was running, so td-gui
  started one itself, with a random bearer token on a random port. td-gui
  watches that process and restarts it once if it dies unexpectedly. If it dies
  a second time, something is wrong that td-gui cannot fix, so it stays down
  and the UI shows its disconnected banner instead of pretending otherwise.
- **`(existing instance)`** means a `td serve` was already running for this
  project, started by an agent or by `td monitor`, and td-gui simply reused it.
  td-gui did not start that process, so it does not stop it either: it keeps
  running after you quit.

If another instance is running with a bearer token that td-gui does not know,
td-gui refuses to start rather than guess:

```
td-gui: a td serve instance is already running on port 41113 with a bearer
token td-gui does not know; stop it, or start td-gui against a different project
```

To work on two projects at the same time, run one td-gui per project. Give each
one its own `--work-dir`, and its own `--port` if you want bookmarks that keep
working.

## Staying up to date

The header carries a dot: green means `connected`, amber means `disconnected`.

td-gui subscribes to td's server-sent event stream, and td sends an event
whenever anything changes, including changes made from the CLI in another
terminal. So when an agent logs progress or closes an issue while you are
looking at it, the page catches up on its own. There is no reload button
because there is nothing to reload.

If the connection drops, a banner appears under the header:

> Backend disconnected — the data shown may be out of date.

The page keeps showing the last data it received. The browser reconnects by
itself, and the banner disappears once it succeeds.

## Theme

The button next to the connection dot cycles through **auto**, **light** and
**dark**. `auto` follows your operating system. Your choice is stored in the
browser, so it applies per device.

## Security

td-gui is a local tool, and its boundaries are deliberate:

- Every listener binds to `127.0.0.1`, never to `0.0.0.0`. Nothing is reachable
  from the network, and the UI is not meant to be exposed through a reverse
  proxy.
- Requests from another origin are rejected, so a random page in another tab
  cannot drive your backlog.
- The bearer token that td-gui uses to reach `td serve` never appears in a
  response body, a response header, or a log line. It *is* visible in the
  process table, because `td serve` only accepts the token as a command-line
  flag, so any local account can read it with `ps`. What the token grants is
  write access to the API, not read access: `.todos/issues.db` is already
  world-readable. Closing this gap needs a change in td itself.

## When something goes wrong

| Message | What it means |
| ------- | ------------- |
| `... is not a td project (no .todos directory)` | Wrong directory, or the project was never initialised. Run `td init` there yourself. |
| `td vX.Y.Z is too old, v0.57.0 or newer is required` | Upgrade td, or point `--td` at a newer binary. |
| `td binary not found in PATH` | td is not on your PATH. Install it, or point `--td` at the binary. |
| `port N is already in use` | Something else is holding the port you asked for. Drop `--port` and let td-gui pick one. |
| ``no web build embedded (run `make web`) — this binary contains no web build`` | A Go binary was built without the frontend bundle. Use `make build`, not a bare `go build`. |
| `td serve did not become reachable within 15s` | The backend started but never answered. Its stderr is passed through to your terminal, so read that first. |

Errors that come from td itself, such as validation or review policy, are shown
in the UI exactly as td phrased them. That wording is the authoritative
explanation, and td-gui does not rewrite it.
