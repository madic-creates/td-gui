# One field block for both issue forms — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 86 lines of field markup duplicated across `IssueForm.tsx`
and `IssueEditForm.tsx` with one shared `IssueFields` component, so a field
added to one form cannot silently miss the other.

**Architecture:** A presentational `IssueFields.tsx` renders every field the two
forms share, taking the draft, the mutation error, an id prefix and the parent
candidates as props. Each form keeps what genuinely differs — its title, its
submit controls, its own state and request. The `boundFields` list moves with
the markup it describes, so there is one list instead of two identical ones.

**Tech Stack:** React 19 + TypeScript, Tailwind, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-17-shared-issue-fields-design.md`

## Global Constraints

- **This is a refactor. No behaviour changes** beyond the one the spec names:
  the create form's description textarea grows from five rows to six.
- **The existing suites are the specification.** `IssueForm.test.tsx` and
  `IssueEditForm.test.tsx` must stay green with **only their `boundFields`
  import line changed**. Needing any other test edit means the refactor
  changed something it should not have — stop and report rather than updating
  the test to match.
- **English only** — code, comments, test names, commit messages. Error text
  produced by `td` is displayed verbatim and never rewritten.
- **No client-side bounds.** No `min`/`max` on points, no `maxLength` on title,
  no date range. Those limits are per-project td config; the server validates
  and the form renders td's answer.
- **`boundFields` must list exactly the fields that render a `<FieldError>`**,
  and `minor` stays off it — it is the one field without an inline error, so a
  message naming it must fall through to the panel.
- **Comments explain *why*, not *what*.** Every comment being moved in this
  plan is load-bearing; move it with its code rather than dropping it.
- **Commits** are Conventional Commits scoped to the package: `refactor(web):`.
- **Frontend commands run from `web/`.** Use `npm test -- --run` (bare
  `npm test` watches in a TTY). Filter: `npm test -- --run IssueForm`.
- `make typecheck` from the repo root is the fastest check of a frontend edit;
  `make lint` adds oxlint; `make test` runs everything and lints first.

## The one subtlety

**`IssueFields` must return a fragment, not a wrapping `<div>`.**

Both call sites space their children with Tailwind's `space-y-4`, which
compiles to a `> * + *` selector — it only reaches *direct* DOM children. A
fragment adds no DOM node, so the fields stay direct children of the form (in
`IssueForm`) and of the bordered section (in `IssueEditForm`), and the spacing
survives. Wrap them in a `div` and every field in both forms loses its vertical
rhythm, collapsing into one block — a change no test asserts and only the eye
catches.

---

### Task 1: The shared component, adopted by the create form

**Files:**
- Create: `web/src/features/issues/IssueFields.tsx`
- Modify: `web/src/features/issues/IssueForm.tsx`
- Modify: `web/src/features/issues/IssueForm.test.tsx` (the import line only)

**Interfaces:**
- Consumes: `IssueDraft` from `./issueDiff`, `Issue`/`IssueType`/`Priority`
  from `../../api/types`, `fieldErrorFor` from `../../api/client`,
  `IssueCombobox` from `../../components/IssueCombobox`, `LabelInput` from
  `./LabelInput`.
- Produces, all from `IssueFields.tsx` and all used by Task 2:
  `default IssueFields(props)`, `FieldError({ error, field })`,
  `boundFields: string[]`, `fieldClass: string`, `legendClass: string`.

- [ ] **Step 1: Write the component**

Create `web/src/features/issues/IssueFields.tsx`:

```tsx
import { fieldErrorFor } from '../../api/client'
import type { Issue, IssueType, Priority } from '../../api/types'
import IssueCombobox from '../../components/IssueCombobox'
import LabelInput from './LabelInput'
import type { IssueDraft } from './issueDiff'

const types: IssueType[] = ['task', 'feature', 'bug', 'chore', 'epic']
const priorities: Priority[] = ['P0', 'P1', 'P2', 'P3', 'P4']

// Exported because both forms style their own title input with them — the one
// field that is not in here.
// oxlint-disable-next-line react/only-export-components
export const fieldClass = 'w-full rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink'
// oxlint-disable-next-line react/only-export-components
export const legendClass = 'mb-1.5 block text-[11px] uppercase tracking-widest text-ink-muted'

interface Props {
  /** `new` or `edit`. Every id and htmlFor in the block is prefixed with it. */
  idPrefix: string
  /** The create or update mutation's error, which the FieldErrors read. */
  error: unknown
  draft: IssueDraft
  set: <K extends keyof IssueDraft>(key: K, value: IssueDraft[K]) => void
  /**
   * Already filtered by the caller. The exclusion rule is not the same for the
   * two forms and the reason lives at the call site: an existing issue cannot
   * be its own parent or its own child, and a new one has neither.
   */
  parentCandidates: Issue[]
}

/**
 * Every field the create and edit forms share, in the order they share it.
 *
 * Presentational on purpose: no state, no query, no mutation. The form that
 * renders it owns the draft and the request, which is what lets one block
 * serve both a POST and a PATCH.
 *
 * The title and the submit controls are deliberately not in here. Create
 * renders a labelled title input; the edit form renders a heading that becomes
 * a larger, aria-labelled input, outside its `editing` gate, which is what
 * lets the title be edited where it is read. Create submits with one inline
 * button; the edit form portals Save and Cancel into a slot its caller
 * provides. A prop cannot express those differences, only hide them.
 *
 * Returns a fragment rather than a wrapper: both call sites space their
 * children with `space-y-4`, which only reaches direct DOM children.
 */
export default function IssueFields({ idPrefix, error, draft, set, parentCandidates }: Props) {
  const id = (name: string) => `${idPrefix}-${name}`

  return (
    <>
      <div>
        <label htmlFor={id('description')} className={legendClass}>Description</label>
        <textarea id={id('description')} rows={6} value={draft.description}
          onChange={e => set('description', e.target.value)} className={fieldClass} />
        <FieldError error={error} field="description" />
      </div>

      <div>
        <label htmlFor={id('acceptance')} className={legendClass}>Acceptance criteria</label>
        <textarea id={id('acceptance')} rows={4} value={draft.acceptance}
          onChange={e => set('acceptance', e.target.value)} className={fieldClass} />
        <FieldError error={error} field="acceptance" />
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div>
          <label htmlFor={id('type')} className={legendClass}>Type</label>
          <select id={id('type')} value={draft.type}
            onChange={e => set('type', e.target.value as IssueType)} className={fieldClass}>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <FieldError error={error} field="type" />
        </div>
        <div>
          <label htmlFor={id('priority')} className={legendClass}>Priority</label>
          <select id={id('priority')} value={draft.priority}
            onChange={e => set('priority', e.target.value as Priority)} className={fieldClass}>
            {priorities.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <FieldError error={error} field="priority" />
        </div>
        <div>
          {/* No min or max: the accepted values are td config, and it names
              them in the error when a value is rejected. */}
          <label htmlFor={id('points')} className={legendClass}>Points</label>
          <input id={id('points')} type="number" value={draft.points ?? ''}
            onChange={e => set('points', e.target.value === '' ? null : Number(e.target.value))}
            className={fieldClass} />
          <FieldError error={error} field="points" />
        </div>
        <div>
          <label htmlFor={id('sprint')} className={legendClass}>Sprint</label>
          <input id={id('sprint')} value={draft.sprint}
            onChange={e => set('sprint', e.target.value)} className={fieldClass} />
          <FieldError error={error} field="sprint" />
        </div>
      </div>

      <div>
        <LabelInput value={draft.labels} onChange={labels => set('labels', labels)} />
        <FieldError error={error} field="labels" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor={id('parent')} className={legendClass}>Parent</label>
          <IssueCombobox id={id('parent')} value={draft.parent_id}
            onChange={next => set('parent_id', next)}
            candidates={parentCandidates}
            placeholder="td-…" className={fieldClass} />
          <FieldError error={error} field="parent_id" />
        </div>
        <div>
          <label htmlFor={id('due')} className={legendClass}>Due date</label>
          <input id={id('due')} type="date" value={draft.due_date}
            onChange={e => set('due_date', e.target.value)} className={fieldClass} />
          <FieldError error={error} field="due_date" />
        </div>
        <div>
          <label htmlFor={id('defer')} className={legendClass}>Defer until</label>
          <input id={id('defer')} type="date" value={draft.defer_until}
            onChange={e => set('defer_until', e.target.value)} className={fieldClass} />
          <FieldError error={error} field="defer_until" />
        </div>
      </div>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={draft.minor}
          onChange={e => set('minor', e.target.checked)} />
        <span>Minor — self-reviewable</span>
      </label>
    </>
  )
}

/**
 * Every field with a `<FieldError>` of its own, across both forms. `title` is
 * on the list although it is rendered by each form rather than by this block —
 * the title is where the two forms differ, but both of them do render its
 * error at its input.
 *
 * `minor` is deliberately absent — it is the one field without a FieldError —
 * so an error naming it, or naming anything td renames later, falls through to
 * the panel instead of rendering nowhere.
 *
 * One list rather than one per form: it describes the placements above, and
 * with the placements shared there is nothing left to keep in step by hand.
 * Each form's suite still runs the completeness guard over it, so an entry
 * that renders in one form and nowhere in the other is still caught.
 */
// oxlint-disable-next-line react/only-export-components
export const boundFields = [
  'title', 'description', 'acceptance', 'type', 'priority', 'points', 'sprint',
  'labels', 'parent_id', 'due_date', 'defer_until',
]

/**
 * Exported because both forms render one for their own title input, which is
 * the field that is not in this block. No oxlint exemption above it: it is a
 * component, which is what that rule allows a component file to export.
 */
export function FieldError({ error, field }: { error: unknown; field: string }) {
  const message = fieldErrorFor(error, field)
  if (!message) return null
  return <p className="mt-1.5 text-[11px] text-danger">{message}</p>
}
```

- [ ] **Step 2: Point the create form at it**

In `web/src/features/issues/IssueForm.tsx`, replace the import block with:

```tsx
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { unboundMessage } from '../../api/client'
import { useCreateIssue } from '../../api/mutations'
import ErrorPanel from '../../components/ErrorPanel'
import IssueFields, { boundFields, FieldError, fieldClass, legendClass } from './IssueFields'
import { blankDraft, createBodyFrom } from './issueCreate'
import type { IssueDraft } from './issueDiff'
import { candidatesFor } from './issueIndex'
import { useIssueIndex } from './useIssueIndex'
```

Delete from that file: the `types` and `priorities` arrays, the `fieldClass`
and `legendClass` constants, the local `boundFields` export and its doc
comment, and the local `FieldError` function. They now live in `IssueFields`.

Keep everything else — the draft state, the `set` helper, the `useIssueIndex`
call and its comment, the `submitting` ref and its comment, the submit handler
and its comment, and the "No client-side length checks" comment above the
return.

Then replace the field markup — everything from the description `<div>` through
the minor checkbox `<label>` — with the component, leaving the title block
above it and the button and panel below it:

```tsx
      <div>
        <label htmlFor="new-title" className={legendClass}>Title</label>
        <input
          id="new-title" value={draft.title} onChange={e => set('title', e.target.value)}
          className={fieldClass}
        />
        <FieldError error={create.error} field="title" />
      </div>

      <IssueFields
        idPrefix="new" error={create.error} draft={draft} set={set}
        // Nothing to exclude: the issue does not exist yet, so it can be
        // neither its own parent nor its own child. candidatesFor still earns
        // its place by sorting closed issues last.
        parentCandidates={candidatesFor(issues, [])}
      />

      <button type="submit" disabled={create.isPending}
        className="rounded-sm border border-accent px-3 py-1 text-[11px] text-accent disabled:opacity-40">
        Create
      </button>
```

- [ ] **Step 3: Repoint the test's import**

In `web/src/features/issues/IssueForm.test.tsx`, line 8:

```ts
import IssueForm from './IssueForm'
import { boundFields } from './IssueFields'
```

**Change nothing else in this file.** Every other line staying untouched is the
evidence that the refactor preserved behaviour.

- [ ] **Step 4: Run the create form's suite**

Run from `web/`: `npm test -- --run IssueForm`
Expected: PASS, 22 tests — the same 22 as before, including the eleven-case
`boundFields` guard.

A failure in the `boundFields` guard means a field's `FieldError` did not
survive the move. A failure in `getByLabelText` means a label or an id
changed. Neither is a reason to edit the test.

- [ ] **Step 5: Typecheck and lint**

Run from the repo root: `make lint`
Expected: clean. If oxlint objects to the non-component exports despite the
`oxlint-disable-next-line` comments, report what it says rather than deleting
the exports — the two forms need them.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/issues/IssueFields.tsx \
        web/src/features/issues/IssueForm.tsx \
        web/src/features/issues/IssueForm.test.tsx
git commit -m "refactor(web): move the shared issue fields into one component

The create and edit forms render the same field block. This is the block,
as a presentational component, with the create form adopting it first. Its
description textarea gains a row, matching the edit form's."
```

---

### Task 2: The edit form adopts it

**Files:**
- Modify: `web/src/features/issues/IssueEditForm.tsx`
- Modify: `web/src/features/issues/IssueEditForm.test.tsx` (the import line only)

**Interfaces:**
- Consumes: `IssueFields`, `FieldError`, `boundFields`, `fieldClass` from
  `./IssueFields` (Task 1). Note this form does **not** need `legendClass` —
  its title input carries an `aria-label` rather than a visible legend.

- [ ] **Step 1: Point the edit form at the component**

In `web/src/features/issues/IssueEditForm.tsx`, replace the import block with:

```tsx
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { unboundMessage } from '../../api/client'
import { useUpdateIssue } from '../../api/mutations'
import type { Issue } from '../../api/types'
import ErrorPanel from '../../components/ErrorPanel'
import IssueFields, { boundFields, FieldError, fieldClass } from './IssueFields'
import { diffIssue, draftFrom, isEmptyPatch, type IssueDraft } from './issueDiff'
import { candidatesFor, childrenOf } from './issueIndex'
import { useIssueIndex } from './useIssueIndex'
```

Delete from that file: the `types` and `priorities` arrays, the `fieldClass`
and `legendClass` constants, the local `boundFields` export and its doc
comment, and the local `FieldError` function. Keep `titleClass`.

**Keep every other line of this file.** In particular keep, with their
comments: the `Props` docstring about `footerSlot` and the portal, the
component's own docstring, the draft re-seeding during render, the `submitting`
ref, the `useEffect` that resets on close, the `submit` handler, the `footer`
with its `form={formId}` explanation, the title block, and the hidden
default-submit button with its explanation. None of that is in scope.

- [ ] **Step 2: Replace the field markup**

The `editing` block becomes:

```tsx
      {editing && (
        <div className="mt-4 space-y-4 border-t border-line-subtle pt-4">
          <IssueFields
            idPrefix="edit" error={update.error} draft={draft} set={set}
            // Excludes the issue itself (it cannot be its own parent) and its
            // own children — picking one would only earn a rejection from td,
            // since the child's existing parent_id already makes that edge a
            // cycle. Longer cycles through a grandchild stay td's to catch,
            // same as DependencyPanel's dependency picker.
            parentCandidates={candidatesFor(issues, [issue.id, ...childrenOf(issues, issue.id).map(c => c.id)])}
          />

          {/* The form's default button, and nothing else — it is what makes
              Enter in a text field save, and Save itself is no longer here to
              be it. The spec resolves the default button from the form's
              associated elements, so the portalled Save ought to serve, but
              jsdom only looks at the form's descendants and the suite is
              where that behaviour is pinned. `hidden` keeps it out of the
              layout and out of the accessible tree; both buttons run the same
              onSubmit, so which one wins the tie does not matter. */}
          <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
        </div>
      )}
```

The title block above it keeps its `FieldError` and `fieldClass`, unchanged.

- [ ] **Step 3: Repoint the test's import**

In `web/src/features/issues/IssueEditForm.test.tsx`, line 7:

```ts
import IssueEditForm from './IssueEditForm'
import { boundFields } from './IssueFields'
```

**Change nothing else in this file.**

- [ ] **Step 4: Run the edit form's suite**

Run from `web/`: `npm test -- --run IssueEditForm`
Expected: PASS, the same count as before the change.

Two failures to read carefully rather than paper over:

- A `boundFields` guard failure means a `FieldError` was lost in the move.
- A failure in the "Enter saves" or portalled-footer tests means the hidden
  default-submit button or the portal was disturbed. Both are outside this
  task's scope, so restore them rather than adjusting the test.

- [ ] **Step 5: Run both suites together**

Run from `web/`: `npm test -- --run`
Expected: PASS, the full 488.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/issues/IssueEditForm.tsx \
        web/src/features/issues/IssueEditForm.test.tsx
git commit -m "refactor(web): render the shared fields in the edit form too

Both forms now render one block, so a field cannot reach one and miss the
other. The exclusion rule for the parent picker stays at the call site,
where the reason for it is."
```

---

### Task 3: Verification

**Files:** none — this task changes nothing.

- [ ] **Step 1: Confirm the duplication is actually gone**

```bash
grep -c "legendClass" web/src/features/issues/IssueForm.tsx web/src/features/issues/IssueEditForm.tsx
grep -rn "const boundFields\|export const boundFields" web/src/features/issues/
```

Expected: `IssueForm.tsx` mentions `legendClass` once (its title label),
`IssueEditForm.tsx` not at all, and two `boundFields` definitions in the
directory: one here, in `IssueFields.tsx`, and `CommentForm.tsx`'s own
unrelated `const boundFields = ['text']`, which binds that form's single
field and has nothing to do with the issue forms.

- [ ] **Step 2: Full suite**

Run from the repo root: `make test`
Expected: golangci-lint clean, oxlint clean, `tsc -b` clean, Go suite ok, the
frontend suite green at 488.

- [ ] **Step 3: Confirm the contract package ran rather than skipping**

Run from the repo root:
`go test ./test/contract/ -v 2>&1 | grep -c -- "--- SKIP"`
Expected: `0`. That package skips itself when the `td` binary is absent while
`go test` still prints `ok`, so a green `make test` alone does not prove it
ran. This branch does not touch Go, so a non-zero count means the environment,
not the change — report it either way.

- [ ] **Step 4: Build**

Run from the repo root: `make build`
Expected: exit 0, and `internal/web/dist/.gitkeep` still present
(`ls internal/web/dist/.gitkeep`).

- [ ] **Step 5: Look at both forms in the running app**

The suites assert labels and values, not layout, and the one thing this
refactor can plausibly break is spacing — see the fragment note at the top of
this plan.

Seed a throwaway project first, so the parent picker has rows and nothing
touches real data:

```bash
mkdir -p /tmp/td-fieldcheck && cd /tmp/td-fieldcheck && td init
td create "Throwaway epic for the layout check" --type epic
td create "A second issue so the parent picker has rows" --type feature
```

Then, from the repo root:

```bash
make build
./td-gui --port 8931 --no-open --work-dir /tmp/td-fieldcheck
```

Open `/new` (the create route is `/new`, not `/issues/new`) and an issue's
detail view with the editor open. Check that the fields in both are spaced
apart rather than collapsed against each other, that the four- and
three-column grids still line up, and that the create form's description box
is now six rows.

- [ ] **Step 6: Record the work in td**

```bash
td link td-67e086 web/src/features/issues/IssueFields.tsx \
  web/src/features/issues/IssueForm.tsx web/src/features/issues/IssueEditForm.tsx \
  web/src/features/issues/IssueForm.test.tsx web/src/features/issues/IssueEditForm.test.tsx
td handoff td-67e086 \
  --done "IssueFields holds the shared field block; both forms render it; one boundFields list" \
  --remaining "Review" \
  --decision "Extracted rather than guarded with an equality test: the two regions differed only in the description rows and the parent candidates, and one list makes the guard structural"
td review td-67e086
```
