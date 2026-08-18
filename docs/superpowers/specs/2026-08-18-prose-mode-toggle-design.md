# Toggle between rendered Markdown and the raw source

td-ea7b3c. Follow-up to td-fc2de1 (Markdown rendering) and td-e74c4d (the GFM
hint). Display only, again: the editors already edit source.

## The problem

td-fc2de1 replaced six verbatim `whitespace-pre-wrap` renders with Markdown and
left no way back. Four things went with it:

- **Verification.** The renderer reflows hard-wrapped paragraphs, and
  pipe-formatted terminal output pasted into a description loses its alignment
  unless the author indented it. The spec for td-fc2de1 records that as a known
  limitation; without a raw view there is no way to see what td actually stored.
- **Copying the source** out of the GUI to reuse it in a CLI invocation.
- **A standing preference.** Some readers want raw text and cannot say so.
- **An escape hatch** when one particular text renders badly.

## The switch is global, sticky, and lives in `Markdown`

One control in the header, next to `ThemeToggle`. Two states, `markdown` and
`raw`, persisted like the theme preference.

The mode is read in exactly one place: `Markdown.tsx`. No call site changes, so
no surface can miss the switch because someone forgot to wire it. Description,
acceptance criteria, comment bodies, review summaries and handoff bullets all
flip together, wherever they are rendered.

### `lib/prose.ts`, shaped like `lib/theme.ts`

```ts
export type ProseMode = 'markdown' | 'raw'
export const PROSE_STORAGE_KEY = 'td-gui.prose'
```

`readStoredMode` / `storeMode` wrap localStorage in the same try/catch as
`theme.ts`: reading throws outright in some sandboxed contexts, and a mode that
survives only this tab still beats a crash. A missing, unreadable or
unrecognised value all degrade to `markdown`, which is what the app does today.

`theme.ts` needs no subscription because it writes `<html data-theme>` and the
stylesheet does the rest. React rendering has no such side channel, so
`prose.ts` also owns a module-level listener set behind `subscribe` /
`readMode` / `setMode`, consumed with `useSyncExternalStore`. That is the
equivalent of the DOM attribute, not extra machinery: the header button and
every mounted `Markdown` have to agree, and a Context provider would have to be
threaded through the tree and into every test that renders prose in isolation.

### `ProseToggle`

Header, left of `ThemeToggle`, same 11px bordered frame and shared `Icon`
holder, so the two quiet affordances read as a pair. Two states rather than
three, so it toggles instead of cycling: no `nextPreference` equivalent, just
the other value.

The label spells out the current state (`markdown` / `raw`), and
`aria-label`/`title` say what a press does, following `ThemeToggle`'s
`Theme: auto. Switch to light.` phrasing. It is an ordinary `<button>`, so
keyboard reach is free. Visible on every view, including ones with no prose, for
the same reason the theme toggle is.

## Raw rendering

`block` and `compact` render a `<pre className="whitespace-pre-wrap">` in the
mono stack at `text-[12px] leading-relaxed`.

- `<pre>`, not a `<div>`: the text genuinely is preformatted here. The author's
  line breaks and indentation are the content, which is the whole point of the
  mode.
- `whitespace-pre-wrap`, not `pre`: alignment survives for anything inside the
  column, and an overlong line wraps instead of scrolling the page sideways.
  Exact alignment of very long lines is worth less than not having to scroll to
  read prose.
- No border and no inset background, unlike the fenced-code block. In this mode
  the whole text is the block; a box drawn around every description is chrome
  that says nothing.

`block` and `compact` differ only in vertical rhythm, as they do when rendered.

The `inline` variant renders `<span className="whitespace-pre-wrap font-mono">`.
Its call site is a handoff bullet, already an `<li>` in a `<ul>`; emitting a
`<pre>` there would nest a block inside a list item, which is the layout bug
the inline variant exists to avoid.

## Safety

Unchanged and still structural. The raw path sets a string as a React child, so
no HTML string exists on it either, and there is still no
`dangerouslySetInnerHTML` in the file. A script tag in a description is text in
both modes, and the test pins it in both.

The doc comment at the top of `Markdown.tsx` explains a file that renders
Markdown. It gains a paragraph on the raw mode, so it does not keep describing
half of what the file does.

## Out of scope

- The editors and `MarkdownHint`. Writing is still GFM and the textareas
  already show source.
- A keyboard shortcut, a third `auto` state, per-section switches.
- A copy-the-source button. `CopyButton` exists; if copying out of the raw view
  turns out to be awkward, that is its own issue.
- Screenshots. td-bbe0cd is open for regenerating them.

## Tests

- `lib/prose.test.ts` — default for missing, unrecognised and throwing storage;
  a write survives a throwing storage; `subscribe` notifies and unsubscribes.
- `Markdown.test.tsx` — in `raw`, `# Heading` appears literally and no `h3` is
  emitted; a script tag stays text in both modes; `inline` raw emits no `pre`;
  changing the store re-renders a mounted `Markdown`, which is the wiring proof.
- `ProseToggle.test.tsx` — shows the current state, a click flips it and
  persists it, the accessible name names both sides.

## Docs

The README and `docs/` passage that describes Markdown rendering, added by
td-7a7eda, gains two sentences on the switch.
