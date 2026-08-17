# New issue form: the fields td accepts at creation

td-e38efb. The "New issue" form offers title, description, type and priority.
POST /v1/issues accepts eight more, and the edit form already renders all of
them — so any issue that needs a label, a sprint or a due date is created,
opened and edited, for metadata a single `td create` takes in one go.

This closes that gap: the create form gets every field the endpoint honours,
all of it in the one POST that creates the issue.

## Scope

In: `acceptance`, `points`, `sprint`, `labels`, `parent_id`, `due_date`,
`defer_until`, `minor`, alongside today's four.

Out: dependencies at creation — see the decision at the end.

## Layout

The fields are flat, in the edit form's order and grid, so create and edit
read as the same form:

```
Title       [__________________________]
Description [                          ]
Acceptance  [                          ]

Type   Priority  Points  Sprint
[task] [P2    ]  [    ]  [     ]

Labels [chip][chip][+ add          ]

Parent        Due date    Defer until
[td-…      ]  [        ]  [        ]

[ ] Minor — self-reviewable

( Create )
```

No progressive disclosure. Most new issues in this project get at least a
label, an estimate or a sprint, so a collapsed section would be open nearly
every time and would only add a click to the common case. The quick path is
protected by every added field being optional, not by hiding it: title, Enter,
done — see `createBodyFrom` below.

`type="date"` for both dates, because it emits td's `YYYY-MM-DD` exactly.
`IssueCombobox` for the parent, `LabelInput` for the labels — the same
components the edit form uses.

## Data flow

### `IssueInput` (`web/src/api/mutations.ts`)

Grows from four fields to twelve: `title` required, and optional
`description`, `acceptance`, `type`, `priority`, `points`, `sprint`, `labels`,
`parent_id`, `due_date`, `defer_until`, `minor`. `useCreateIssue` is otherwise
unchanged — it already posts whatever body it is handed.

### Draft state

`IssueForm` replaces its four `useState` calls with one `IssueDraft` — the
same type the edit form holds, already exported from `issueDiff.ts` — updated
through the same `set(key, value)` helper.

A new `web/src/features/issues/issueCreate.ts` holds the two functions the
create side needs. It imports the `IssueDraft` type from `issueDiff.ts` rather
than moving it: that type is shared, but `diffIssue`'s clearing semantics are
PATCH-only and do not belong to creation.

- `blankDraft(): IssueDraft` — empty strings, `points: null`, `labels: []`,
  `type: 'task'`, `priority: 'P2'`, `minor: false`.
- `createBodyFrom(draft: IssueDraft): IssueInput` — the create counterpart to
  `diffIssue`.

`createBodyFrom` always sends `title`, `type` and `priority`: all three are
visible in the form, so sending them states what the user sees. Everything
else is omitted when it is empty — `''` for the text and date fields, `[]` for
labels, `null` or a non-finite number for points, `false` for minor. Nothing
is ever sent as an empty string, so td applies its own defaults to fields the
user did not fill. That is the create-side equivalent of the edit form's
"omitted means unchanged", and it is what keeps the quick path quick: title
and submit posts `{title, type, priority}` and nothing more.

Points follows `diffIssue`'s reasoning — an unparseable entry is `NaN`, which
would serialise to `null`, so it is omitted rather than sent.

### Parent candidates

`IssueCombobox` over `useIssueIndex()`, with no exclusions: at creation there
is no self to exclude and no children to exclude. It adds a `/v1/issues` fetch
to `/issues/new`, normally already in cache from the list view.

`IssueEditForm.tsx` is not touched.

## Errors

Every added field renders a `<FieldError>` at its input, and `boundFields` in
`IssueForm.tsx` grows to the same eleven names as the edit form's:

```
title, description, acceptance, type, priority, points, sprint,
labels, parent_id, due_date, defer_until
```

`minor` stays off the list for the reason it is off the edit form's — it is
the one field with no `FieldError` above it, so a message naming it has to
fall through to the panel rather than render nowhere. The list is exported so
the suite can prove each entry really renders at an input.

That split routes td's two create-time error shapes correctly, with no new
code:

- `{"points":4}` and `{"due_date":"friday"}` return `validation_error` with
  `details.fields`, so `fieldErrorFor` binds them to their input.
- `{"parent_id":"td-zzzzzz"}` returns `not_found`, message `parent issue not
  found: td-zzzzzz`, with **no** `details.fields`, so `unboundMessage` hands
  it to the `ErrorPanel`.

Both render td's wording verbatim.

No client-side bounds are introduced: no `min`/`max` on points, no `maxLength`
on title, no date range. Those limits are per-project td config and the server
is what validates them.

## Tests

`web/src/features/issues/IssueForm.test.tsx`:

1. Every field filled, submit — exactly one POST, body carries all twelve
   values.
2. Title only, submit — body is exactly `{title, type, priority}`. No empty
   strings, no nulls.
3. Points blank, and points typed as an unparseable entry — the key is absent
   from the body.
4. A `validation_error` naming `points` renders at the points input, and not
   in the panel.
5. The `parent_id` `not_found`, which carries no `details.fields`, renders in
   the `ErrorPanel`.
6. The `boundFields` completeness guard: `it.each` over the export, asserting
   each message appears exactly once — the same shape and rationale as
   `IssueEditForm.test.tsx`'s, which catches both a stale entry (renders
   nowhere) and a missing one (renders twice).

`test/contract/contract_test.go` gains `TestCreateFieldsContract`: one POST
with all twelve fields against a real `td serve`, asserting every value lands
on the created issue and no follow-up PATCH is needed. The frontend suite runs
on msw and so proves nothing about td itself; this is what pins the endpoint's
actual behaviour. The same test asserts that `depends_on` in a create body is
ignored, which makes the scope decision below an executable fact — if td ever
starts honouring it, the test says so.

`make test` must be green with `test/contract` actually running: a missing
`td` binary makes that package skip itself while still printing `ok`, so the
run is only meaningful with td v0.57.0+ on PATH.

## Decision: dependencies at creation are out of scope

`td create` accepts `--depends-on` and `--blocks`, but POST /v1/issues
silently ignores both — the issue is created with empty `dependencies` and
`blocked_by`. Supporting them here would mean a second request to
POST /v1/issues/{id}/dependencies after the create returns, which introduces a
partial-failure path this form does not have today: the issue exists, the
dependency was rejected, and the form has already navigated away.

Creating an issue already lands on its detail view, where `DependencyPanel` is
on screen. The round trip that this issue exists to remove — create, find,
open, edit — does not apply to dependencies, which are one panel away at the
place the user already is.

Recorded rather than left open, per the issue's acceptance criteria, and
pinned by the contract test above.
