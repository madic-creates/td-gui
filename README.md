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

Grab a binary from the [latest release](https://github.com/madic-creates/td-gui/releases/latest)
(`td-gui-vX.Y.Z-linux-amd64`, with a `.sha256` next to it), or build it:

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
td-gui --version          # released binaries print their tag, local builds "dev"
```

## Development

```bash
make test                 # Go and frontend tests
cd web && npm run dev     # Vite dev server, proxying to td-gui on :7777
```

Run `td-gui --port 7777 --no-open` in one shell and `npm run dev` in another
to get hot reload against real data.

## Releases

Releases are cut automatically by go-semantic-release when CI is green on
`main`. The commit subjects decide the version, so the Conventional Commit
scope in [CLAUDE.md](CLAUDE.md) is what ships a release:

| Commit                                | Bump  |
| ------------------------------------- | ----- |
| `feat:`                               | minor |
| `fix:`, `perf:`, `refactor:`, `chore(deps):` | patch |
| any type with `!`                     | major |
| `docs:`, `test:`, `ci:`, `style:`     | none  |

The release job tags the commit, writes the changelog into the GitHub Release
and attaches the `linux/amd64` binary plus its checksum. That binary is built
in the release job itself, not reused from CI, because the tag has to be
stamped into it via `-ldflags -X main.buildVersion=`.

## Design

See [docs/superpowers/specs/2026-08-14-td-gui-design.md](docs/superpowers/specs/2026-08-14-td-gui-design.md).

## License

td-gui is licensed under the Apache License 2.0 — see [LICENSE](LICENSE).

It is an independent project and contains no code from td; it drives the `td`
binary and its HTTP API from the outside. td itself is a separate work by
Marcus Vorwaller, distributed under the MIT License.
