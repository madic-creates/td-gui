# td-gui visual design pass

**Date:** 2026-08-14
**Status:** approved, ready for planning

## Problem

td-gui works but has almost no visual design. The frontend uses a minimal
Tailwind utility set — spacing, hairline borders, two grey text tones. There is
no application shell, no visual distinction between issue states, no focus
styling at all, and the loading, empty and error states are single lines of
unstyled text.

This is not a defect. The CSS bundle builds, loads and applies correctly
(verified: `/assets/index-*.css` returns 200, 27 rules active, computed styles
match the utilities in the source). The app is simply unfinished visually.

## Goal

Give td-gui a deliberate visual identity and the UI structure that identity
needs, without adding features, endpoints or new screens.

## Chosen direction: terminal-adjacent

Monospace-forward, dense, dark-first, colour used only for signal. td-gui is a
window onto td state that sits next to a running Claude Code session; its data
is overwhelmingly identifiers, status enums and log lines. Density and
scannability matter more than whitespace.

Two directions were rejected: a Linear/GitHub-style product look (familiar but
generic) and an editorial serif treatment (attractive but degrades badly past
~50 rows).

## Non-goals

These are explicitly out of scope. Each would be its own change:

- Keyboard shortcuts. The mockups showed `[n] new issue`; that is a feature.
- Board, kanban, grouping or sorting views.
- Any new td endpoint or API call.
- A manual light/dark toggle with persisted state.
- Internationalisation of any kind. English remains the only language.

## Foundation

### Typography rule

Monospace for data, sans-serif for prose. Applied consistently:

| Monospace | Sans-serif |
|---|---|
| Issue IDs, status, priority | Issue title in the detail header |
| Field labels, section labels | Description body |
| Log types, timestamps | Comment text |
| Issue titles **in the list** | Handoff bullet items |
| Pagination, filter chips | Empty-state hint text |

List titles stay monospace because they are scanned in an aligned column.
The detail title becomes sans because there it is a heading, not a cell.

Stacks:

```
--font-mono: ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, Consolas, monospace
--font-sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif
```

### Colour tokens

No component ever writes a literal colour or a Tailwind palette class such as
`neutral-500`. Components reference semantic tokens only: `bg-surface`,
`text-ink-muted`, `border-line`. This is what makes the second theme nearly
free.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `surface` | `#fdfdfc` | `#0d1117` | page background |
| `surface-raised` | `#f6f8fa` | `#0f141b` | handoff panel, comment cards |
| `surface-inset` | `#f6f7f8` | `#010409` | inputs, header bar |
| `surface-hover` | `#f2f4f6` | `#161b22` | row hover |
| `line` | `#e3e5e8` | `#21262d` | borders |
| `line-subtle` | `#eff1f2` | `#161b22` | row dividers |
| `ink` | `#1f2328` | `#e6edf3` | primary text |
| `ink-muted` | `#57606a` | `#8b949e` | IDs, meta, labels |
| `ink-faint` | `#686f79` | `#7d8590` | placeholders, disabled |
| `accent` | `#956400` | `#d29922` | brand, active filters, focus ring |
| `accent-bg` | `#fff8e6` | `#1c1710` | active filter chip background |
| `danger` | `#cf222e` | `#f85149` | errors, destructive transitions |
| `success` | `#1a7f37` | `#3fb950` | connected dot, approve, handoff "Done" |
| `warn` | `#916100` | `#e3b341` | disconnected banner |

Status tokens, one per td status:

| Status | Light | Dark |
|---|---|---|
| `open` | `#0969da` | `#58a6ff` |
| `in_progress` | `#956400` | `#d29922` |
| `in_review` | `#8250df` | `#a371f7` |
| `blocked` | `#cf222e` | `#f85149` |
| `closed` | `#57606a` | `#8b949e` |

`ink-faint` is deliberately darker in light mode and lighter in dark mode than
the values used in the mockups; the mockup values fell below 4.5:1 against
their backgrounds. Every text token must be verified at ≥4.5:1 against every
background it actually renders on, in both themes, before this work is
considered done — including translucent backgrounds (`bg-warn/10`,
`bg-danger/5`) composited over the surface behind them, not measured against
the opaque token. That composited check is what caught `warn`: at `#9a6700`
it cleared 4.5:1 against the opaque `warn` swatch but only reached 4.21:1
once actually composited at 10% over `surface` in light mode, so light
`warn` was darkened to `#916100` (hue unchanged, ≤0.1°) and light
`ink-faint` to `#686f79` (hue +1.96°) to clear 4.5:1 on `surface-hover`, the
tightest of the four backgrounds it sits on. Dark-mode values were already
compliant everywhere and were left untouched.

### Theme mechanism

Tailwind v4, CSS-first, no config file — matching what the project already
does. In `web/src/index.css`:

```css
@import "tailwindcss";

@theme inline {
  --color-surface: var(--td-surface);
  --color-ink-muted: var(--td-ink-muted);
  /* … one mapping per token above … */
  --font-mono: ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, Consolas, monospace;
}

:root {
  --td-surface: #fdfdfc;
  /* … light values … */
}

@media (prefers-color-scheme: dark) {
  :root {
    --td-surface: #0d1117;
    /* … dark values … */
  }
}
```

`@theme inline` is required (not plain `@theme`) because the values are
references to other custom properties. No React state, no flash of wrong theme
on load, no toggle UI.

### Density and focus

- Row height 35px total (currently ~44px): `py-2` (8px top + 8px bottom) around
  a 12px/1.5 line box (18px), plus the row's 1px bottom border — 8+18+8+1.
  `px-4` (16px) horizontal. `SkeletonRows` sets this height explicitly so it
  cannot drift from the real row again.
- Base size 12px for chrome, 13px for prose, 20px for the detail title.
- Section rhythm 24px.
- A global `:focus-visible` ring on `accent`, 2px, 2px offset. The app
  currently has no focus styling whatsoever, so tab navigation is invisible.

## Screens

### Application shell (new)

`App.tsx` currently renders routes and a banner with no chrome around them. It
gains a persistent header: brand mark, connection indicator, "New issue"
action. No sidebar — three routes do not justify one.

Connection state is split across two elements because they say different
things:

- **Header dot** — ambient state. Green `success` when connected, amber `warn`
  when not, with the word beside it.
- **Warning strip** — consequence. Still rendered only when disconnected. Its
  text and `role="status"` are unchanged; only the colours move to tokens.

### Issue list

- Row grid: ID in a fixed monospace column, title flexible, priority and status
  right-aligned on a shared edge so they form real columns when scrolling.
- `P0`/`P1` in `danger`, bold. `P2`–`P4` in `ink-muted`, regular.
- Status rendered in its own status token colour, lowercase, letter-spaced.
- Hover: `surface-hover` plus a 2px `accent` inset edge on the left, so the
  row the click will hit is unambiguous.

**Filters become chips but stay checkboxes.** They look like toggle buttons but
remain `<input type="checkbox">` with an `sr-only` label. Switching to
`<button role="switch">` would cost keyboard behaviour, screen-reader
semantics, and the existing tests — for a purely visual gain.

Four states, all currently a single line of text:

| State | Now | After |
|---|---|---|
| Loading | `Loading …` | skeleton rows at final row height, so nothing jumps when data arrives |
| Empty | `No issues found.` | centred block, plus a hint naming the likely cause (active filters) |
| Error | red paragraph | bordered danger panel with a `Request failed` label |
| Disconnected | full-width amber bar | same bar, tokenised |

The error panel frames td's message. It never rewrites it. This is the
`CLAUDE.md` invariant and the tests in `web/src/api/client.test.ts` and
`web/src/features/issues/IssueDetail.test.tsx` pin it.

### Issue detail

- Header: ID small and muted **above** the title; title as the only sans
  heading; below it `type` · `priority` · `status` as three bordered tags
  replacing today's `·`-joined string. Only priority and status carry colour —
  three coloured items in one line compete.
- **Transitions** remain exactly what td reports in `available_transitions`,
  and the bar still renders nothing when the field is absent. The only change
  is that `approve` gets a `success` border and `reject`/`block` a `danger`
  border. Error text below stays verbatim.
- **Handoff panel** moves from a stacked list to a two-column grid with four
  colour-coded groups: Done `success`, Remaining `accent`, Decisions
  `ink-muted`, Uncertain `in_review` violet. This is the first thing read after
  a context switch; the four categories must be separable at a glance.
- **Activity**: log type as a narrow coloured monospace column, message as
  sans prose, relative timestamp right-aligned.
- **Comments**: bordered cards on `surface-raised` with a header line carrying
  a shortened session id — the first four characters, rendered as
  `session 4f2a` — and a relative timestamp.

### Forms

Labels as small monospace uppercase. Inputs on `surface-inset` with the accent
focus ring. Field errors in `danger` directly under the field, carrying td's
wording unchanged — no client-side length validation is introduced, since
title bounds are per-project td config.

## New data on screen

`LogEntry.timestamp`, `Comment.created_at` and `session_id` already arrive from
td and are currently discarded. They are now rendered as relative times
("2h ago") and a shortened session id. This is the one place where the change
goes beyond styling, and it was explicitly approved: an activity feed without
times is hard to read.

## Components

New, each with one job:

| File | Responsibility |
|---|---|
| `components/AppShell.tsx` | header, connection indicator, main region |
| `components/StatusTag.tsx` | status string → token colour |
| `components/PriorityTag.tsx` | priority string → token colour and weight |
| `components/EmptyState.tsx` | centred message plus optional hint |
| `components/ErrorPanel.tsx` | labelled danger frame around a verbatim message |
| `components/SkeletonRows.tsx` | placeholder rows at list row height |
| `lib/time.ts` | absolute ISO timestamp → relative string |

`lib/time.ts` formats as: under 60 seconds `just now`; under an hour `Nm ago`;
under a day `Nh ago`; under seven days `Nd ago`; beyond that the absolute date
as `YYYY-MM-DD`. An unparseable timestamp returns the empty string rather than
`Invalid Date`.

`StatusTag` and `PriorityTag` map unknown values to the neutral token and
render the raw string rather than throwing, so a future td status does not
break the list.

Modified: `App.tsx`, `ConnectionBanner.tsx`, `IssueList.tsx`,
`IssueFilters.tsx`, `IssueDetail.tsx`, `TransitionBar.tsx`, `CommentForm.tsx`,
`IssueForm.tsx`, `index.css`, `index.html`.

Deleted: `web/src/App.css` — 2.8KB of Vite scaffold that nothing imports.

Also fixed: `web/index.html` still carries Vite's default `<title>web</title>`.
It becomes `td-gui`.

## Testing

Existing tests query by role, label and text, never by class, so restyling does
not break them provided every visible string, `role`, `aria-label` and form
label is preserved exactly. That constraint is part of this work, not an
accident to be discovered.

New tests:

- `lib/time.ts` — relative formatting boundaries (seconds, hours, days).
- `StatusTag` — renders an unknown status verbatim with neutral styling.
- `ErrorPanel` — renders the message it is given, character for character.

Contrast ratios are verified manually against the table above; there is no
automated check for them.

`make test` must stay green. Note that `test/contract` skips silently when `td`
is not on PATH — `td` is currently not installed in this shell, so a green run
proves less than it appears to.

## Risks

- **jsdom cannot evaluate `prefers-color-scheme`.** The dark theme is not
  covered by automated tests; it is verified by looking at the running app.
- **Contrast is verified by hand.** The table above is the reference; if a
  value changes during implementation, it must be re-checked.
- **Density is a preference.** 34px rows may read as cramped once there are
  real issue counts. The row height is a single token, so it is cheap to
  revisit.
