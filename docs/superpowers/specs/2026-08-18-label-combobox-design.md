# Clickable, filterable label suggestions

td issue: td-2eb2c5
Date: 2026-08-18

## Problem

The label field in the create and edit forms takes free text and nothing else
that a reader can see. Adding a label that the project already uses means
remembering how it was spelled, because the field never shows the set to pick
from. A typo does not fail: td validates nothing on labels, so `back-end` and
`backend` sit side by side in the project forever.

The suggestions are in fact already wired up: `LabelInput.tsx:78` renders a
`<datalist id="label-suggestions">` fed by `useLabels()`, and the input on
`LabelInput.tsx:58` points at it with `list="label-suggestions"`. What a
`<datalist>` does not give is a visible affordance: there is no control to
click, browsers disagree on whether the list opens on focus or only after the
first character, and labels already on the issue are offered again alongside
the rest. The feature reads as absent because nothing on screen says it is
there.

## What already exists

`useLabels()` (`web/src/api/queries.ts:57`) requests `GET /v1/labels` and
returns `{ default_workflow, labels }` — every label used anywhere in the
project. No new endpoint and no backend change are needed.

`IssueCombobox` (`web/src/components/IssueCombobox.tsx`) already solves the
same interaction for issue ids: a listbox that opens on focus, filters as the
reader types, walks under the arrow keys, and closes on Escape, selection or
blur. Its details were paid for once and should not be rediscovered — in
particular the `onMouseDown` guard on the `<ul>`, without which blur closes the
list before a row's click can land, and the rule that a closed list has no
active row, without which a stale highlight eats the next Enter.

`LabelInput` is consumed only by `IssueFields.tsx`, the field block shared by
the create and the edit form, so a single change covers both.

## Design

### Not a generic component

The listbox lives inside `LabelInput`, not in a shared component. Generalising
`IssueCombobox` was considered and rejected: it is typed on `Issue`, ranks an
exact id match to the top, caps its list at `MAX_OPTIONS` with a notice, and
renders `StatusTag` plus id plus title per row. Turning that into something
that also renders bare strings would cost more than the roughly forty lines it
saves, and would put a second consumer on a component whose two current callers
are the reason its behaviour is shaped the way it is. `IssueCombobox` stays the
reference, not the dependency.

### Suggestions

The candidate list is the project labels minus those already on the issue.
Matching against `value` is by exact string, not case-folded or trimmed: td
stores labels verbatim, so `Bug` and `bug` are two labels and hiding one
because the other is applied would be a lie.

The typed text filters the candidates by case-insensitive substring — `end`
finds `backend` and `frontend`. Substring rather than prefix, matching what
`IssueCombobox` does. The order is whatever `GET /v1/labels` returns; no
ranking, since there is no id to match exactly against.

There is no cap. `IssueCombobox` caps at 20 because its candidate pool is td's
1000-issue page; a project's distinct labels are a much smaller set, and the
list scrolls at `max-h-64` the same way. If a project ever accumulates enough
labels for that to hurt, the filter is the answer.

The list is open when the input has focus and at least one candidate survives
the filter. So it does not appear when every project label is already on the
issue, and it disappears when the typed text matches none — a new label being
typed should not be shadowed by a panel showing nothing.

### Interaction

- Focus or click opens the list. Typing keeps it open and clears the active row.
- Clicking a row adds that label, clears the input and closes the list.
- ArrowDown opens a closed list; on an open one it moves the active row, from
  none to the first. ArrowUp on a closed list is left to the caret so that
  moving to position 0 in the input still works.
- Enter with an active row adds that row's label. Enter without one adds the
  typed text, which is today's behaviour and the only way to introduce a label
  the project has not used yet. Both call `preventDefault`, because the field
  sits inside a form at both call sites and Enter must not submit it.
- Escape closes the list and leaves the typed text alone.
- Blur closes the list.
- The "Add label" button stays, unchanged, as the mouse path for free text.

### What does not change

- The `<datalist>` is deleted. Keeping it alongside the listbox would mean two
  suggestion panels racing for the same keystrokes.
- No frontend validation. td accepted `has space`, so nothing here rejects
  input either.
- Removal stays by index, because td does not dedup on its write path and an
  issue can carry a literal duplicate from the CLI.
- The `Props` contract (`value: string[]`, `onChange(labels)`) is untouched, so
  `IssueFields` and both forms need no edit.

### Accessibility

The input carries `role="combobox"`, `aria-expanded`, `aria-controls`,
`aria-autocomplete="list"`, `autoComplete="off"` and `aria-activedescendant`
pointing at the active row's id. The `<ul>` is `role="listbox"` with
`aria-label="Label suggestions"`; rows are `role="option"` with
`aria-selected`. This mirrors `IssueCombobox` exactly.

The existing `<label for="label-entry">` stays, so `getByLabelText('Labels')`
keeps resolving to the input.

## Testing

`web/src/features/issues/LabelInput.test.tsx` already stubs `GET /v1/labels`
with `['alpha', 'beta']` through msw. New cases:

- clicking into the field shows the project labels as options
- clicking an option adds it and closes the list
- a label already on the issue is not offered
- typing filters the options by substring, case-insensitively
- Enter on an arrowed-to row adds that label and does not submit the form
- Escape closes the list and keeps the typed text

The existing `offers the project labels as suggestions` case asserts on the
`<datalist>` via `hidden: true` and is replaced by the first of these. The
other four existing cases stand as they are.

## Out of scope

Renaming or deleting a label across the project, label colours, and filtering
the issue list by label. None of them are this field's job.
