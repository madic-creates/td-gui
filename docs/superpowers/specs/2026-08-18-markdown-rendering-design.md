# Render issue long text as Markdown

td-fc2de1. Display only: the edit form keeps editing raw source.

## The problem

Six places render td's long text verbatim inside
`<p className="whitespace-pre-wrap">`:

| Site | Field |
| --- | --- |
| `IssueDetail.tsx:157` | description |
| `IssueDetail.tsx:171` | acceptance criteria |
| `IssueDetail.tsx:263` | comment body |
| `ReviewPanel.tsx:44` | active review summary |
| `ReviewPanel.tsx:68` | superseded review summary |
| `IssueDetail.tsx` `HandoffPanel` | handoff bullet items |

td issue text is written in a terminal and is Markdown in practice. This
project's own issues use headings, `-` lists, fenced code blocks, backticked
identifiers and links. Showing the source characters costs us the one thing a
GUI offers over `td show`: readable long-form text.

This reverses a deliberate earlier decision. The comment above the acceptance
section argues the CLI's leading dashes are "the author's, not a list this view
gets to re-render as markup". That held while the field was treated as one
opaque blob. It is replaced, not left standing next to code that contradicts it.

## Renderer: react-markdown with remark-gfm

Two new production dependencies in `web/`. The frontend may take a dependency
(the stdlib-only rule in CLAUDE.md is about the Go server), and this is a
renderer plus a plugin, not an editor stack.

Chosen over the alternatives because safety here is structural rather than
configured:

- **react-markdown** produces React elements directly. There is no HTML string
  at any point, so no `dangerouslySetInnerHTML` appears anywhere in the change.
  Without `rehype-raw`, raw HTML in the source is never parsed into nodes; it
  survives as escaped text. The injection surface is removed rather than
  guarded.
- **marked plus DOMPurify** is smaller and faster, but produces an HTML string,
  so every call site needs `dangerouslySetInnerHTML` and correctness depends on
  a sanitiser config staying right. The issue permits this. It keeps a live XSS
  surface where the other option has none.
- **A hand-rolled renderer** avoids the dependency but the acceptance criteria
  require nested lists, fenced code, tables, blockquotes and links. That is a
  real parser, several hundred lines, and every edge case becomes ours.

`remark-gfm` supplies tables, strikethrough and autolinks.

## The component

One new file, `web/src/components/Markdown.tsx`, one component, a `variant`
prop:

| variant | call sites | behaviour |
| --- | --- | --- |
| `block` (default) | description, acceptance | full GFM, normal spacing |
| `compact` | comment bodies, both review summaries | full GFM, tightened vertical rhythm, inherits `text-[11px]` |
| `inline` | handoff bullet items | `allowedElements={['a','code','em','strong','del']}` with `unwrapDisallowed` |

`compact` and `block` differ only in spacing. They are not separate parsers and
not separate security surfaces.

`inline` exists for one structural reason: handoff items are already `<li>`
elements inside a `<ul>`, and the handoff card's two-column grid was tuned for
flat one-line bullets. A nested block list inside an existing list item reads as
a layout bug. Under `unwrapDisallowed`, block constructs degrade to their text
content instead of nesting, and backticks, emphasis and links still render.

### Link safety

A `components.a` override forces `target="_blank"` and
`rel="noopener noreferrer"`. react-markdown's `defaultUrlTransform` already
returns an empty string for `javascript:` and other unsafe protocols, so no
hand-rolled scheme allowlist is needed. A test pins the behaviour rather than
trusting it silently.

## Styling

The `components` map assigns the project's existing design tokens. No
`@tailwindcss/typography`: its `prose` class carries `max-width: 65ch`, which
would fight the deliberate no-max-width decision on this column, and its
defaults are not this project's palette.

- `pre` and `code`: `bg-surface-inset`, `font-mono`
- `table`, `th`, `td`, `blockquote`: `border-line`
- `a`: `text-accent`
- `ul` and `ol`: `list-disc` / `list-decimal` with `pl-5`

Headings inside issue text render one step down from the section heading above
them, so a `#` in a description cannot outrank the "Description" label.

`table` and `pre` are wrapped in an `overflow-x-auto` box. This is what keeps
the no-max-width decision working in practice: the prose column stays full
width, and content wider than it scrolls inside its own container instead of
stretching the page.

## Line breaks

Standard CommonMark soft-break behaviour. A hard-wrapped paragraph is joined
and reflowed to the column width. No `remark-breaks`.

This is the intended fix. Hard wrapping is an artefact of composing text in a
terminal, not authored structure, and re-imposing the author's terminal column
inside a wide browser column reproduces the defect rather than the intent.

## Accepted limitation

Indented terminal output (four or more spaces) becomes a code block and is
preserved exactly.

Pipe-aligned ASCII output with no indentation and no GFM delimiter row is
reflowed into a paragraph and loses its alignment. Mitigating this needs
heuristics that would misfire on ordinary prose containing a pipe character.
The workaround is to indent such blocks, which is already the convention. This
is recorded rather than hidden because the issue asked for the check.

## Call sites

The five `<p className="whitespace-pre-wrap">` elements become `<Markdown>`
with the variant from the table above, and the handoff `<li>` gains
`<Markdown variant="inline">`.

The verbatim-acceptance comment at `IssueDetail.tsx:164` is replaced with one
recording why the reversal is correct and why `inline` exists for handoffs. The
issue is explicit that the comment must not be left contradicting the code.

`IssueEditForm` is not touched. It binds `issue.description` raw, so a
display-only change cannot affect round-tripping.

## Testing

New `web/src/components/Markdown.test.tsx`:

- **Formatting**: headings, ordered and unordered lists including nesting,
  fenced and inline code, tables, blockquotes, emphasis, links.
- **Security**: a `<script>` tag in a description reaches the DOM as text and
  `document.querySelector('script')` is null; an `onerror` attribute never
  becomes a property; `[x](javascript:alert(1))` produces no live href.
- **Reflow**: a hard-wrapped paragraph joins into a single `<p>`.
- **Plain prose**: text containing no Markdown renders as it does today.
- **Variants**: `inline` does not emit `<ul>` or `<pre>`; `block` does.

Existing `IssueDetail.test.tsx` and `ReviewPanel.test.tsx` assertions that
query for the text of a description, comment or summary must stay green.
Queries that depend on the text sitting in a single `<p>` are updated to match
the rendered structure.

`make test` green, including `make typecheck`.
