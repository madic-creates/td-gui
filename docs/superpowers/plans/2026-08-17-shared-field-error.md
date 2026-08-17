# One FieldError for every form — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** td-dd5624. One `FieldError` component in `web/src/components/`, used by
every form that renders td's per-field messages, instead of a copy per feature.

**Architecture:** `FieldError` moves to `components/FieldError.tsx` as a default
export, matching its sibling `ErrorPanel`. `IssueFields` stops exporting it, and
each consumer imports it directly. No behaviour changes anywhere.

**Tech Stack:** React 19 + TypeScript, Tailwind, vitest + @testing-library/react.

**Issue:** td-dd5624. No separate spec — the issue's own description carries the
design, and this plan records the two things it did not know (below).

## Global Constraints

- **This is a refactor. No behaviour changes at all.** Every existing suite must
  stay green without edits. Needing a test change means the move altered
  something it should not have — stop and report rather than updating the test.
- **td's message is rendered verbatim** — never reworded, truncated or
  prettified. That is the whole reason this component exists, and it is the
  rule `ErrorPanel` carries too.
- **English only** — code, comments, test names, commit messages.
- **Commits** are Conventional Commits scoped to the package: `refactor(web):`.
- **Frontend commands run from `web/`.** Use `npm test -- --run` (bare
  `npm test` watches in a TTY).
- Baseline is **492** frontend tests across 44 files. Task 1 adds a test file,
  so the count rises; a *drop* at any point is a finding.

## Two things the issue did not know

**There are three live copies, not two.** Besides `IssueFields.tsx:171` and
`BoardForm.tsx:120`, `CommentForm.tsx:40-41` inlines the same markup without
wrapping it in a component, and calls `fieldErrorFor` twice to do it. Task 2
covers it, and is separable — the issue named only `BoardForm`, so Task 2 can
be dropped without affecting Task 1.

**`FieldError` is already a type name.** `web/src/api/types.ts:171` exports an
`interface FieldError` — one row of td's `details.fields`, consumed by
`api/client.ts`. The new component shares its name and nothing else. They never
appear in the same file, so there is no collision to resolve, but an implementer
searching for "FieldError" will find both: the interface is td's wire shape, the
component renders one of them.

---

### Task 1: The shared component and its three consumers

**Files:**
- Create: `web/src/components/FieldError.tsx`
- Create: `web/src/components/FieldError.test.tsx`
- Modify: `web/src/features/issues/IssueFields.tsx`
- Modify: `web/src/features/issues/IssueForm.tsx`
- Modify: `web/src/features/issues/IssueEditForm.tsx`
- Modify: `web/src/features/boards/BoardForm.tsx`

**Interfaces:**
- Produces: `default FieldError({ error, field }: { error: unknown; field: string })`
  from `web/src/components/FieldError.tsx`.
- Removes: the named `FieldError` export from `IssueFields.tsx`, and the local
  `function FieldError` in `BoardForm.tsx`.

- [ ] **Step 1: Write the component's test**

Create `web/src/components/FieldError.test.tsx`. It mirrors
`ErrorPanel.test.tsx`, which is the house pattern for a small presentational
component in this directory:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ApiError } from '../api/client'
import FieldError from './FieldError'

const rejected = new ApiError('validation_error', 'Validation failed', 400, [
  { field: 'title', rule: 'min_length', value: 'ab', expected: 15,
    message: 'title too short (2 chars, min 15)' },
])

describe('FieldError', () => {
  // td phrases its validation errors precisely and its wording is
  // authoritative. This renders one; it must never reword it.
  it("renders td's message for its field, character for character", () => {
    render(<FieldError error={rejected} field="title" />)
    expect(screen.getByText('title too short (2 chars, min 15)')).toBeInTheDocument()
  })

  // The forms render one of these under every field, so the common case is an
  // error that names a different field — or no error at all.
  it('renders nothing when the error names another field', () => {
    const { container } = render(<FieldError error={rejected} field="description" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing without an error', () => {
    const { container } = render(<FieldError error={null} field="title" />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

Check `ApiError`'s constructor signature in `web/src/api/client.ts` before
running this — it takes the code, the message, the status and the fields. If
the shape differs, match the file rather than this snippet, and say so in your
report.

- [ ] **Step 2: Run it and watch it fail**

Run from `web/`: `npm test -- --run FieldError`
Expected: FAIL — `Failed to resolve import "./FieldError"`.

- [ ] **Step 3: Write the component**

Create `web/src/components/FieldError.tsx`:

```tsx
import { fieldErrorFor } from '../api/client'

interface Props {
  /** A rejected mutation's error. Anything else renders nothing. */
  error: unknown
  /** td's own name for the field, as it appears in `details.fields`. */
  field: string
}

/**
 * td's message for one field, under that field's input. Renders nothing when
 * the error names a different field or there is no error, so a form can place
 * one under every input unconditionally.
 *
 * The message is rendered verbatim — td phrases these precisely and its
 * wording is authoritative, the same rule ErrorPanel carries. Which messages
 * reach an input and which fall through to the panel is the caller's business:
 * see `unboundMessage` in api/client.ts and the `boundFields` list each form
 * hands it.
 */
export default function FieldError({ error, field }: Props) {
  const message = fieldErrorFor(error, field)
  if (!message) return null
  return <p className="mt-1.5 text-[11px] text-danger">{message}</p>
}
```

- [ ] **Step 4: Run it and watch it pass**

Run from `web/`: `npm test -- --run FieldError`
Expected: PASS, 3 tests.

- [ ] **Step 5: Switch the issue forms**

In `web/src/features/issues/IssueFields.tsx`:

- Delete the local `FieldError` function at the foot of the file **and its doc
  comment**, which explains why it was exported — that reason no longer exists.
- Add `import FieldError from '../../components/FieldError'`.
- Delete `import { fieldErrorFor } from '../../api/client'` — the component was
  its only user in this file. Confirm with a search before deleting.

In `web/src/features/issues/IssueForm.tsx` and
`web/src/features/issues/IssueEditForm.tsx`, both of which render a
`FieldError` for their own title input:

- Drop `FieldError` from the `./IssueFields` import, keeping the rest
  (`boundFields`, `fieldClass`, and `legendClass` in `IssueForm` only).
- Add `import FieldError from '../../components/FieldError'`.

- [ ] **Step 6: Switch the board form**

In `web/src/features/boards/BoardForm.tsx`:

- Delete the local `function FieldError` at the foot of the file.
- Add `import FieldError from '../../components/FieldError'`.
- Change `import { fieldErrorFor, unboundMessage } from '../../api/client'` to
  import `unboundMessage` alone — `unboundMessage` is still used for the panel,
  `fieldErrorFor` no longer is.

- [ ] **Step 7: Run the suites that cover the consumers**

Run from `web/`: `npm test -- --run IssueForm IssueEditForm BoardForm FieldError`
Expected: PASS, all of them, with no test file edited.

The real regression net here is the `boundFields` completeness guard in
`IssueForm.test.tsx` and `IssueEditForm.test.tsx`: it asserts each of td's
messages appears **exactly once**, so a `FieldError` that stopped rendering
shows up as 0 and one that rendered twice as 2.

- [ ] **Step 8: Lint and typecheck**

Run from the repo root: `make lint`
Expected: clean. An unused-import warning here means a `fieldErrorFor` import
outlived its use — delete it rather than suppressing it.

- [ ] **Step 9: Commit**

```bash
git add web/src/components/FieldError.tsx web/src/components/FieldError.test.tsx \
        web/src/features/issues/IssueFields.tsx web/src/features/issues/IssueForm.tsx \
        web/src/features/issues/IssueEditForm.tsx web/src/features/boards/BoardForm.tsx
git commit -m "refactor(web): one FieldError for every form

Boards and issues each carried their own copy of the same four lines.
The component moves to components/, beside ErrorPanel, so neither feature
imports the other to render td's message under an input."
```

---

### Task 2: The comment form's inlined copy

Separable from Task 1 and beyond the letter of td-dd5624, which named only
`BoardForm`. Drop this task and Task 1 still stands.

**Files:**
- Modify: `web/src/features/issues/CommentForm.tsx`

**Interfaces:**
- Consumes: `default FieldError` from `web/src/components/FieldError` (Task 1).

- [ ] **Step 1: Replace the inlined markup**

`web/src/features/issues/CommentForm.tsx:40-41` currently reads:

```tsx
      {fieldErrorFor(add.error, 'text') && (
        <p className="mt-1.5 text-[11px] text-danger">{fieldErrorFor(add.error, 'text')}</p>
      )}
```

That is the same four lines as the component, unwrapped, calling
`fieldErrorFor` twice for one message. Replace with:

```tsx
      <FieldError error={add.error} field="text" />
```

Add `import FieldError from '../../components/FieldError'`, and drop
`fieldErrorFor` from the `../../api/client` import if nothing else in the file
uses it — check before deleting; `unboundMessage` is used and stays.

- [ ] **Step 2: Run the comment form's suite**

Run from `web/`: `npm test -- --run CommentForm`
Expected: PASS, unchanged, with no test file edited.

`CommentForm.tsx` has its own local `boundFields = ['text']`, which stays local
and correct: it is that form's own binding, unrelated to the issue forms'
shared list.

- [ ] **Step 3: Commit**

```bash
git add web/src/features/issues/CommentForm.tsx
git commit -m "refactor(web): render the comment form's field error like the rest

Same four lines again, inlined rather than wrapped, and calling
fieldErrorFor twice for one message."
```

---

### Task 3: Verification

**Files:** none — this task changes nothing.

- [ ] **Step 1: Confirm one definition remains**

```
grep -rn "fieldErrorFor" web/src
```

Expected: exactly three lines — the definition in `web/src/api/client.ts`,
and the import plus the single call in `web/src/components/FieldError.tsx`. One
caller of that helper in the entire app is what "one copy" means here.

The two earlier greps were replaced because their expected output did not match
reality: the class string `text-[11px] text-danger` is shared by unrelated
components (`ConfirmButton`, `BoardCard`, `CommentForm`), and the pattern
`function FieldError` matches the component's own definition (`export default
function FieldError`), making both impossible to verify correctly.

- [ ] **Step 2: Full suite**

Run from the repo root: `make test`
Expected: golangci-lint clean, oxlint clean, `tsc -b` clean, Go suite ok, and
the frontend suite at 495 — the 492 baseline plus Task 1's three new tests,
whether or not Task 2 ran, since Task 2 adds none. A number below 492 means a
suite lost tests and is a finding; report the number you actually saw rather
than the number expected here.

- [ ] **Step 3: Confirm the contract package ran rather than skipping**

Run from the repo root:
`go test ./test/contract/ -v 2>&1 | grep -c -- "--- SKIP"`
Expected: `0`. That package skips itself when the `td` binary is absent while
`go test` still prints `ok`. This branch touches no Go, so a non-zero count
means the environment rather than the change — report it either way.

- [ ] **Step 4: Build**

Run from the repo root: `make build`
Expected: exit 0, and `internal/web/dist/.gitkeep` still present
(`ls internal/web/dist/.gitkeep`). Confirm the binary exists afterwards
(`ls -la td-gui`) — a `make build` that reports success without producing one
has not been run.

- [ ] **Step 5: Record the work in td**

```bash
td link td-dd5624 web/src/components/FieldError.tsx web/src/components/FieldError.test.tsx \
  web/src/features/issues/IssueFields.tsx web/src/features/issues/IssueForm.tsx \
  web/src/features/issues/IssueEditForm.tsx web/src/features/boards/BoardForm.tsx \
  web/src/features/issues/CommentForm.tsx
td handoff td-dd5624 \
  --done "FieldError lives in components/ with its own test; issues, boards and the comment form all render it" \
  --remaining "Review" \
  --decision "Default export in components/ beside ErrorPanel rather than a cross-feature import, so boards never imports from issues"
td review td-dd5624
```
