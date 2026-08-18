# td-gui documentation

How to run td-gui, and what each screen does. If you have never started it,
begin with [Getting started](getting-started.md).

| Page | What's in it |
| ---- | ------------ |
| [Getting started](getting-started.md) | Starting it, the flags, the connection dot, sharing a backend with a running agent, troubleshooting |
| [Working with issues](issues.md) | The list, filters and sorting, the detail page, creating and editing |
| [Transitions and reviews](reviews.md) | The status flow, reasons, review attribution, why td sometimes refuses |
| [Boards](boards.md) | Saved TDQ queries, the backlog view and pinning, swimlanes and drag-to-transition |

Two things are worth knowing before you read any of it.

**td-gui never writes to the database.** It forwards everything to `td serve`,
so every change goes through td itself: its validation, its action log, its
review policy. Anything td refuses, td-gui refuses too, and in td's own words.

**The screen only shows what td reports.** If a transition button is missing,
td did not offer it. If a row of metadata is missing, that field is not set.
Nothing here is filled in with a placeholder or a guess.

Design notes on how each feature was built live in
[superpowers/specs](superpowers/specs). They are developer history, not usage
documentation.
