# td-gui

A local web UI for [td](https://github.com/marcus/td) — browse, create, edit
and transition issues in a browser instead of the terminal.

## How it works

td-gui does not touch `.todos/issues.db`. It discovers or starts td's own
`td serve` HTTP API and reverse-proxies to it, so every write goes through
td's migrations, action log and review policy — exactly as if you had typed
the CLI command.

## Requirements

- `td` **v0.57.0** or newer on your PATH
- Go 1.25 and Node 20+ to build

## Install

```bash
make build
./td-gui
```

## Usage

Run it inside a td project:

```bash
td-gui                    # picks a free port, opens your browser
td-gui --port 7777        # fixed port
td-gui --no-open          # do not open a browser
td-gui --work-dir ../other-project
td-gui --td /path/to/td   # use a specific td binary
```

## Development

```bash
make test                 # Go and frontend tests
cd web && npm run dev     # Vite dev server, proxying to td-gui on :7777
```

Run `td-gui --port 7777 --no-open` in one shell and `npm run dev` in another
to get hot reload against real data.

## Design

See [docs/superpowers/specs/2026-08-14-td-gui-design.md](docs/superpowers/specs/2026-08-14-td-gui-design.md).
