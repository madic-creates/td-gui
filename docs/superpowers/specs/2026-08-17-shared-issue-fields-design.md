# One field block for both issue forms

td-67e086. `IssueForm.tsx` and `IssueEditForm.tsx` each render the same 86
lines of field markup. Nothing fails when they drift, so a thirteenth field
added to one and not the other would ship unnoticed.

## What is actually duplicated

Measured rather than estimated. Normalising the `new-`/`edit-` id prefix, the
`create.error`/`update.error` object and line wrapping, the two regions differ
in exactly two places:

- `rows={5}` versus `rows={6}` on the description textarea. There is no reason
  for it; the two files were written months apart.
- The parent picker's `candidates`: create passes `candidatesFor(issues, [])`,
  edit excludes the issue itself and its children.

Everything else — every label, every `FieldError`, the four-column
type/priority/points/sprint grid, `LabelInput`, the three-column
parent/due/defer grid, the minor checkbox, and the comment explaining why
points carries no min or max — is byte-identical.

## The component

`web/src/features/issues/IssueFields.tsx` renders that region and nothing
else. It is presentational: it holds no state, issues no query and owns no
mutation.

```ts
interface Props {
  /** `new` or `edit`. Every id and htmlFor in the block carries it. */
  idPrefix: string
  /** The mutation error the FieldErrors read. */
  error: unknown
  draft: IssueDraft
  set: <K extends keyof IssueDraft>(key: K, value: IssueDraft[K]) => void
  /** Already filtered by the caller — see below. */
  parentCandidates: Issue[]
}
```

`parentCandidates` is a prop rather than the component calling
`useIssueIndex()` itself, so the exclusion rule stays where the context for it
is. The edit form knows it must exclude the issue and its children and why;
the create form knows there is nothing to exclude because the issue does not
exist yet. Both comments stay at their call site, where they are true.

The description rows unify at 6, the edit form's value: the create form is the
one with an accidental 5, and 6 is the more useful size for the field.

## What does not move

- **The title.** Create renders a labelled input above the description. Edit
  renders an `<h1>` when closed and an aria-labelled, larger-typed input when
  open, outside the `editing` gate entirely — that is what lets the title be
  edited where it is read. They are different components of the page, not one
  component with a flag.
- **The submit controls.** Create has an inline Create button. Edit has a
  Save/Cancel footer that portals into a slot the caller provides, plus a
  hidden default-submit button that keeps Enter working. Both carry comments
  explaining why, and both stay.
- Everything else in `IssueEditForm` — the draft re-seeding on open, the
  `update.reset()` on close, the `useId` form id, the portal — is outside the
  field region and is not touched.

`fieldClass` and `legendClass` move to `IssueFields.tsx` and are exported: the
title inputs in both forms use `fieldClass`, and the create form's title label
uses `legendClass`. `types`, `priorities` and the `FieldError` component are
used only inside the region and move wholesale.

## boundFields

Both files currently export an identical eleven-name list, each with a doc
comment saying it describes the `FieldError` placements above it and therefore
has to live beside them. That reasoning is right, and it is why the list moves
with the markup: one set of placements, one list, exported from
`IssueFields.tsx`.

This is the point of the change. A test asserting the two lists are equal was
the alternative, and it treats the symptom — with one list there is nothing to
compare, and the guard is structural rather than something the suite has to
remember to check.

Both test files keep their own `it.each` completeness guard, importing the
shared list. That is deliberate duplication of the *test*, not the list: the
same names get checked against two different renderings, so an entry that
renders at an input in one form and nowhere in the other is still caught.

## Testing

No behaviour changes, so the existing suites are the specification:
`IssueForm.test.tsx` (22 tests) and `IssueEditForm.test.tsx` must both stay
green with only their `boundFields` import changed. Any other edit to those
files means the refactor changed something it should not have, and is a signal
to stop rather than to update the test.

The one intended visible change is the description textarea growing from five
rows to six on the create form.

`IssueFields.tsx` gets no test file of its own. It renders no logic and holds
no state; the two form suites already drive every field in it through real
user interaction, and a third suite mounting it directly would assert that
markup is markup.
