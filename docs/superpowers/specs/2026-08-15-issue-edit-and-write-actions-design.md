# Issue edit form and the remaining issue-level write actions

td issue: td-79cc52 (epic td-5206e8)
Date: 2026-08-15

## Problem

`useUpdateIssue` exists in `web/src/api/mutations.ts` but nothing imports it.
The detail view is read-only apart from comments and transitions, while
`td serve` accepts a full `PATCH`, two deletes, dependency writes and a focus
set. This closes gap class 2 of the epic: writes the API accepts that the GUI
never issues.

## What td actually does

Verified against td v0.57.0 by probing a live `td serve`, not read from
documentation. Three findings contradict or extend the issue description and
are load-bearing for the design.

**`null` is a no-op; `""` clears.** For `defer_until`, `due_date` and
`parent_id`, sending `null` leaves the stored value untouched. Sending `""`
clears it to null. The issue description's "YYYY-MM-DD or null" is wrong. Every
clear operation in this feature depends on getting this right.

**`points` takes `0` to clear, and rejects `""` without field errors.**
`{"points": 0}` succeeds and clears the estimate. `{"points": ""}` fails with
`invalid JSON: json: cannot unmarshal string into Go struct field
IssueUpdateBody.points of type int` and **no** `details.fields`. The points
input must therefore always send a number.

**Two different error shapes.** `PATCH` validation errors carry
`details.fields[]` and bind per field. Dependency errors and JSON type errors
carry a message only:

| Request | Response |
|---|---|
| `{"title":"ab"}` | field `title`, rule `min_length`, `title too short (2 chars, min 15)` |
| `{"points":-3}` | field `points`, rule `enum`, expected `[1,2,3,5,8,13,21]` |
| `{"due_date":"nonsense"}` | field `due_date`, rule `date_format` |
| `POST` dependency on self | message only: `cannot add dependency: would create circular dependency` |
| `POST` dependency on unknown id | message only: `issue not found: td-zzzzzz` |

Also confirmed: `PATCH` returns `{issue}` and leaves omitted fields unchanged;
`labels: []` clears and labels are not validated; `DELETE /v1/issues/{id}` is a
soft delete, so the issue leaves the list but a direct `GET` still returns it;
`GET /v1/labels` returns `{default_workflow, labels[], workflows[]}`; and
**there is no `GET /v1/focus`** — it answers 405, so focus is write-only.

## Scope

In: the full `PATCH` form, issue delete, comment delete, dependency add and
remove, focus set.

Out: board placement (`POST /v1/boards/{id}/issues`). No acceptance criterion
asks for it and the GUI has no board surface to place onto — it would be a
control pointing at nothing.

Dependencies render here as a bare id list with a remove control. td-7a8b61
owns enriching those rows with titles and statuses; this issue does not
duplicate that work.

## Design

### The diff function is the centre

`features/issues/issueDiff.ts` exports a pure
`diffIssue(original, draft): IssuePatch` that encodes every rule above:

- a field equal to the original is **omitted** — this is what makes "omitted
  fields stay unchanged" true by construction rather than by discipline;
- a cleared `defer_until`, `due_date` or `parent_id` sends `""`, never `null`;
- a cleared points sends `0`, never `""`;
- cleared labels send `[]`.

It is pure and has no React dependency, so the td semantics it encodes are
tested directly rather than through a rendered form.

### Components

| File | Responsibility |
|---|---|
| `features/issues/issueDiff.ts` | draft + original → minimal PATCH body |
| `features/issues/IssueEditForm.tsx` | draft state, field layout, per-field error binding |
| `features/issues/LabelInput.tsx` | label chips plus add, `<datalist>` from `GET /v1/labels` |
| `features/issues/DependencyPanel.tsx` | dep id list, add by id, remove |
| `features/issues/IssueActions.tsx` | header row: Edit toggle, Focus, Delete |
| `components/ConfirmButton.tsx` | inline two-step confirm, shared by all three destructive actions |

`api/mutations.ts` gains `useDeleteIssue`, `useDeleteComment`,
`useAddDependency`, `useRemoveDependency` and `useSetFocus`, and
`useUpdateIssue` is retyped from `Partial<IssueInput>` (title, description,
type, priority only) to the full `IssuePatch`. `api/queries.ts` gains
`useLabels()`. `api/types.ts` gains `IssuePatch` and the labels response shape.

### Interaction

Editing is an inline toggle, not a modal and not a separate route. `TransitionBar`
already established the inline expanding panel for actions needing extra input,
and the app has no dialog primitive. `IssueDetail` owns an `editing` boolean;
when set, the header chips and description section swap for `IssueEditForm`
while the id, activity and comments stay put.

Destructive actions confirm in place: the control swaps into a confirm/cancel
pair where it stands. One `ConfirmButton` serves issue delete, comment delete
and dependency remove.

Focus is a fire-and-forget button with a transient acknowledgement. Because
there is no `GET /v1/focus`, a persistent "currently focused" indicator would
be client-invented state — the same thing the `available_transitions` precedent
forbids. The GUI can set focus; it cannot claim to know it.

### Data flow and edge cases

Save runs `diffIssue`; an empty diff closes the form without issuing a request
at all. On success td's response is authoritative and the form closes.

**The draft is seeded once, on open.** `useLiveUpdates` invalidates the detail
query on every SSE event, so a background refresh while someone is typing must
not clobber the form. Draft state initialises when Edit opens and is never
re-synced from refetches.

Deleting the issue navigates to `/`, because the detail route would otherwise
keep rendering a soft-deleted issue that a direct `GET` still returns.
Everything else invalidates the detail query.

### Errors

Field-bound errors render under their input through the existing
`fieldErrorFor`, verbatim. Message-only errors — dependency rejections, JSON
type errors — render in an `ErrorPanel` beside the action that caused them.
Binding those to a field would display nothing, which is the failure mode this
split exists to prevent.

No client-side validation is introduced: no `maxLength` on title, no `min` or
`max` on points. `due_date` and `defer_until` use `type="date"`, which emits
exactly td's `YYYY-MM-DD`. This is an input affordance rather than the length
or range validation the acceptance criteria forbid, at the cost of making td's
`invalid date format` message unreachable in practice.

## Testing

| Test | Pins |
|---|---|
| `issueDiff.test.ts` | unchanged → omitted; cleared date → `""`; cleared points → `0`; empty diff → no request |
| `IssueEditForm.test.tsx` | PATCH body carries only changed fields; field error renders verbatim against its input |
| `ConfirmButton.test.tsx` | two-step confirm; cancel restores without firing |
| `DependencyPanel.test.tsx` | add posts `{depends_on}`; circular-dependency message shown verbatim |
| `IssueDetail.test.tsx` | delete navigates to list; comment delete; focus PUT |
| `test/contract/contract_test.go` | `null` is a no-op and `""` clears; `points: 0` clears while `points: ""` errors without fields |

The contract test carries the most weight. `diffIssue` is built entirely on the
null-versus-empty-string asymmetry, which is undocumented and contradicts the
issue description. If a future td release changes it, every clear operation
silently stops working; the contract test turns that into a failure instead.

## Acceptance criteria mapping

- *Every PATCH-able field editable, omitted fields unchanged* — `IssueEditForm`
  covers title, description, acceptance, type, priority, points, labels,
  parent_id, sprint, minor, defer_until, due_date; `diffIssue` guarantees the
  omission.
- *Field-level errors shown verbatim against the offending field* — the
  two-shape error split above.
- *Delete, comment delete, dependency add/remove and focus reachable, with
  confirmation* — `IssueActions`, `ConfirmButton`, `DependencyPanel`.
- *No client-side length or range validation* — stated above, with the
  `type="date"` affordance called out explicitly.
