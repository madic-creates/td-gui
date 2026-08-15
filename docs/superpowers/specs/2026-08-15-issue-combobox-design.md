# Searchable issue combobox for dependency and parent fields

td issue: td-409dce
Date: 2026-08-15

## Problem

Two fields in the UI expect an issue id and offer nothing but a `td-…`
placeholder: the "Add dependency" field in `DependencyPanel.tsx:68` and the
parent field in `IssueEditForm.tsx:168`. Both require the reader to already
know the id of the issue they mean, which in practice means leaving the detail
view, finding the issue in the list, copying its id, and coming back. Titles
are what people remember; ids are what the fields accept.

These are the only two typed-id inputs in the app. Focus is always set from an
issue's own page, and the create form takes a title only, so nothing else is in
scope.

## What already exists

`useIssueIndex()` returns `{ index, issues }` — the full, unfiltered issue list
capped at td's maximum `limit` of 1000, with titles, status and priority.
`DependencyPanel` already consumes its `index` to resolve dependency ids to
titles; the `issues` array it also returns is used today only by
`RelatedIssues`. The query is deliberately identical to the one `IssueList`
issues, so react-query serves it from cache on mount. **The suggestions need no
new request and no backend change.**

`LabelInput` solves a similar problem with a `<datalist>`. That is not enough
here: which browsers filter on an option's label text rather than its value is
inconsistent, the ordering cannot be controlled, and a status tag cannot be
rendered. A headless dependency (Downshift and friends) was rejected as well —
`web/package.json` carries exactly three runtime dependencies, and a fourth for
a widget used in two places does not fit the project.

## Design

### `IssueCombobox`

A new presentational component at `web/src/components/IssueCombobox.tsx`. It
knows nothing about react-query or mutations: it filters, renders and reports
the typed or selected id back.

```ts
interface Props {
  id: string                    // input id, so callers keep their own <label>
  value: string
  onChange: (value: string) => void
  candidates: Issue[]
  placeholder?: string
  className?: string            // styles the input; the wrapper stays `relative`
}
```

Callers pass candidates from `useIssueIndex().issues`. Selection writes the
bare id into `value`, so every existing submit path stays unchanged whether the
id was typed or picked.

### Candidate selection

A pure function in `web/src/features/issues/issueIndex.ts`, next to
`indexById`, `resolve` and `isResolved`, testable without rendering:

```ts
export function candidatesFor(issues: Issue[], exclude: Iterable<string>): Issue[]
```

It drops every excluded id and sorts open issues before closed ones, leaving
the incoming order otherwise intact. Closed issues stay selectable — td allows
a dependency on a closed issue, and `DependencyPanel` has a "Resolved" group
precisely because such dependencies exist — but they belong at the bottom.

### Filtering and interaction

The typed text is trimmed and lowercased and matches when it occurs as a
substring of either the id or the title. Substring, not prefix, so "storage"
finds an issue whose title carries the word in the middle. An empty field shows
the full candidate list.

The list opens on focus and on typing, and closes on Escape, Tab and blur.
Escape does not clear the text. Arrow Down and Arrow Up move the active option,
Enter takes it.

**Enter must not submit while the list is open.** Both fields sit inside a
form. When the list is open with an active option, Enter selects it and calls
`preventDefault()`; a second Enter then submits. `LabelInput` already handles
its own Enter this way.

At most 20 matches render, with a line below reading `20 of 143 matches — keep
typing` when more exist. A thousand candidates would otherwise open a thousand
DOM rows. The cap is visible, never silent.

Each row shows the id in mono, the title, and a `StatusTag`. Markup follows the
ARIA combobox pattern: `role="combobox"` on the input with `aria-expanded`,
`aria-controls` and `aria-autocomplete="list"`, a `role="listbox"` holding
`role="option"` rows, and `aria-activedescendant` pointing at the active row so
a screen reader follows the arrow keys. The listbox is absolutely positioned
inside a `relative` wrapper and uses the existing `border-line` / `bg-surface`
tokens.

### Call sites

`DependencyPanel` destructures `{ index, issues }` from `useIssueIndex` and
replaces the input at lines 68–74. Excluded are the issue itself and every
`depends_on_id` already present in `dependencies`. The input's `id` and its
label text stay exactly as they are, so existing tests that type by label keep
working.

`IssueEditForm` replaces the parent input at line 168. Only the issue itself is
excluded — whether a parent would create a cycle is td's judgement, not ours,
and the server's rejection is displayed verbatim as always. An empty field
still clears the parent; `issueDiff` already treats `''` that way.

Free text remains submittable in both fields. The candidate list is capped at
1000 issues, so a strict select would make a valid id unreachable, and the
project's rule is that the frontend does not validate — the server answers.

## Testing

- `issueIndex.test.ts` — `candidatesFor`: excluded ids dropped, open before
  closed, order otherwise stable.
- `IssueCombobox.test.tsx` (new) — filtering by title, filtering by id, arrow
  keys plus Enter select a row, Enter with the list open does not submit the
  surrounding form, Escape closes without clearing the text, the `20 of N`
  notice appears past the cap.
- `DependencyPanel.test.tsx` — picking a suggestion and submitting sends that
  id to the add mutation; existing cases stay green.
- `IssueEditForm.test.tsx` — picking a parent produces a `parent_id` patch;
  clearing the field still clears the parent.

No Go code changes, no new dependency. `make test` covers the whole change.
