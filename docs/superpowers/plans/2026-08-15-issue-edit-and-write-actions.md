# Issue Edit Form and Remaining Write Actions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every PATCH-able field of an issue editable from the detail view and wire up the remaining issue-level writes — issue delete, comment delete, dependency add/remove and focus.

**Architecture:** A pure `diffIssue()` turns a form draft plus the stored issue into the minimal PATCH body, so "omitted fields stay unchanged" holds by construction. Editing is an inline toggle inside `IssueDetail` (the `TransitionBar` precedent), not a modal or a separate route. Destructive actions confirm in place through one shared `ConfirmButton`.

**Tech Stack:** React 19 + TypeScript, TanStack Query, react-router, Tailwind v4, Vitest + Testing Library + msw. Go stdlib for the contract tests.

**Source spec:** `docs/superpowers/specs/2026-08-15-issue-edit-and-write-actions-design.md`

## Global Constraints

- **English only** — UI strings, code, comments, commit messages, docs. No i18n layer.
- **Error text from td is displayed verbatim**, never rewritten or translated.
- **No client-side field limits.** No `maxLength` on title, no `min`/`max` on points. Bounds are per-project td config; the server validates and the form displays the server's answer.
- **`type="date"` is permitted** for `due_date` and `defer_until` — it emits td's `YYYY-MM-DD` exactly. This is an input affordance, not length or range validation.
- **Never open `.todos/issues.db`, never run `td init`.** Every write goes through `td serve`.
- **Go server is stdlib only** — no framework, no router library.
- **Clearing a field sends `""`, never `null`.** td treats `null` on `defer_until`, `due_date` and `parent_id` as "field absent" and leaves the stored value alone. Verified against td v0.57.0.
- **`points` clears with `0`, never `""`.** `{"points":""}` returns a JSON unmarshal error carrying **no** `details.fields`.
- Commits use Conventional Commits with a package scope: `feat(web):`, `test:`, `docs:`.
- Every commit message ends with the trailer:
  `Claude-Session: https://claude.ai/code/session_01XS469PFMwxSvQ2HeckpT93`
- Frontend commands run from `web/`. Use `npm test -- --run` — bare `npm test` watches.
- `make test` lints first and needs `golangci-lint` v2. Contract tests **skip** when `td` is not on PATH; check for `--- SKIP` before trusting a green run.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `web/src/api/types.ts` | add `IssuePatch`, `LabelsResponse` | 1 |
| `web/src/features/issues/issueDiff.ts` | draft ↔ issue, minimal PATCH body | 1 |
| `web/src/features/issues/issueDiff.test.ts` | pins td's clearing semantics | 1 |
| `web/src/api/client.ts` | allow `PUT` in `apiSend` | 2 |
| `web/src/api/mutations.ts` | delete/dependency/focus hooks, retyped update | 2 |
| `web/src/api/queries.ts` | `useLabels()` | 2 |
| `web/src/components/ConfirmButton.tsx` | inline two-step confirm | 3 |
| `web/src/features/issues/LabelInput.tsx` | label chips + datalist | 4 |
| `web/src/features/issues/IssueEditForm.tsx` | draft state, fields, error binding | 5 |
| `web/src/features/issues/IssueActions.tsx` | Edit / Focus / Delete header row | 6 |
| `web/src/features/issues/IssueDetail.tsx` | edit toggle, comment delete, panels | 6, 7, 8 |
| `web/src/features/issues/DependencyPanel.tsx` | dep list, add by id, remove | 7 |
| `test/contract/contract_test.go` | pins null-vs-`""` and points asymmetry | 9 |

---

### Task 1: The diff function and its types

The centre of the feature. Pure, no React, so td's semantics are tested directly rather than through a rendered form.

**Files:**
- Modify: `web/src/api/types.ts` (append after `IssueDetail`)
- Create: `web/src/features/issues/issueDiff.ts`
- Test: `web/src/features/issues/issueDiff.test.ts`

**Interfaces:**
- Consumes: `Issue`, `IssueType`, `Priority` from `web/src/api/types.ts`
- Produces: `IssuePatch`, `LabelsResponse` (types); `IssueDraft`, `draftFrom(issue: Issue): IssueDraft`, `diffIssue(original: Issue, draft: IssueDraft): IssuePatch`, `isEmptyPatch(patch: IssuePatch): boolean`

- [ ] **Step 1: Add the types**

Append to `web/src/api/types.ts`:

```ts
/**
 * The PATCH /v1/issues/{id} body. Every field is optional: an absent field
 * means "leave unchanged".
 *
 * Nullable fields clear with an empty string, not with null — td treats a null
 * here as "field absent" and leaves the stored value alone. points is the
 * exception: it clears with 0 and rejects "" with a JSON type error.
 */
export interface IssuePatch {
  title?: string
  description?: string
  acceptance?: string
  type?: IssueType
  priority?: Priority
  points?: number
  labels?: string[]
  parent_id?: string
  sprint?: string
  minor?: boolean
  defer_until?: string
  due_date?: string
}

/** GET /v1/labels. It also returns `workflows`, which the GUI does not use. */
export interface LabelsResponse {
  default_workflow: string
  labels: string[]
}
```

- [ ] **Step 2: Write the failing tests**

Create `web/src/features/issues/issueDiff.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { diffIssue, draftFrom, isEmptyPatch } from './issueDiff'
import type { Issue } from '../../api/types'

const issue: Issue = {
  id: 'td-6a0883', title: 'Probe issue for API shape', description: 'A description',
  status: 'open', type: 'feature', priority: 'P1', points: 5, labels: ['alpha', 'beta'],
  parent_id: 'td-5206e8', acceptance: 'must work', sprint: 'S1',
  implementer_session: null, creator_session: null, reviewer_session: null,
  review_requested_by_session: null, closed_by_session: null,
  created_at: '2026-08-14T15:01:46+02:00', updated_at: '2026-08-14T15:04:10+02:00',
  reviewed_at: null, closed_at: null, deleted_at: null, minor: false,
  created_branch: null, defer_until: '2026-08-20', due_date: '2026-09-01',
  defer_count: 0,
}

describe('diffIssue', () => {
  it('omits every field when nothing was edited', () => {
    const patch = diffIssue(issue, draftFrom(issue))
    expect(patch).toEqual({})
    expect(isEmptyPatch(patch)).toBe(true)
  })

  it('sends only the fields that changed', () => {
    const draft = { ...draftFrom(issue), title: 'A different title entirely' }
    expect(diffIssue(issue, draft)).toEqual({ title: 'A different title entirely' })
  })

  // td treats null as "field absent" and leaves the value alone. Only an empty
  // string clears. This is the assumption the whole feature rests on.
  it('clears dates with an empty string, never null', () => {
    const draft = { ...draftFrom(issue), due_date: '', defer_until: '' }
    expect(diffIssue(issue, draft)).toEqual({ due_date: '', defer_until: '' })
  })

  it('clears parent_id with an empty string', () => {
    const draft = { ...draftFrom(issue), parent_id: '' }
    expect(diffIssue(issue, draft)).toEqual({ parent_id: '' })
  })

  // "" would fail as a JSON unmarshal error carrying no field details, so an
  // empty points input has to become 0.
  it('clears points with 0, never an empty string', () => {
    const draft = { ...draftFrom(issue), points: null }
    expect(diffIssue(issue, draft)).toEqual({ points: 0 })
  })

  it('treats an unparseable points entry as no change', () => {
    const draft = { ...draftFrom(issue), points: Number.NaN }
    expect(diffIssue(issue, draft)).toEqual({})
  })

  it('clears labels with an empty array', () => {
    const draft = { ...draftFrom(issue), labels: [] }
    expect(diffIssue(issue, draft)).toEqual({ labels: [] })
  })

  it('sends labels when one is added', () => {
    const draft = { ...draftFrom(issue), labels: ['alpha', 'beta', 'gamma'] }
    expect(diffIssue(issue, draft)).toEqual({ labels: ['alpha', 'beta', 'gamma'] })
  })

  it('reads null issue fields as empty strings so an untouched draft is clean', () => {
    const blank: Issue = { ...issue, parent_id: null, defer_until: null, due_date: null, points: 0 }
    expect(diffIssue(blank, draftFrom(blank))) .toEqual({})
  })

  it('sends the boolean and enum fields when toggled', () => {
    const draft = { ...draftFrom(issue), minor: true, type: 'bug' as const, priority: 'P0' as const }
    expect(diffIssue(issue, draft)).toEqual({ minor: true, type: 'bug', priority: 'P0' })
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npm test -- --run issueDiff`
Expected: FAIL — `Failed to resolve import "./issueDiff"`.

- [ ] **Step 4: Write the implementation**

Create `web/src/features/issues/issueDiff.ts`:

```ts
import type { Issue, IssuePatch, IssueType, Priority } from '../../api/types'

/**
 * The editable shape the form holds. Every field is present because a
 * controlled input always has a value; the nullable issue fields become empty
 * strings so an untouched draft diffs to nothing.
 */
export interface IssueDraft {
  title: string
  description: string
  acceptance: string
  type: IssueType
  priority: Priority
  /** null is the empty input, which clears the estimate. */
  points: number | null
  labels: string[]
  parent_id: string
  sprint: string
  minor: boolean
  defer_until: string
  due_date: string
}

export function draftFrom(issue: Issue): IssueDraft {
  return {
    title: issue.title,
    description: issue.description,
    acceptance: issue.acceptance,
    type: issue.type,
    priority: issue.priority,
    points: issue.points === 0 ? null : issue.points,
    labels: [...issue.labels],
    parent_id: issue.parent_id ?? '',
    sprint: issue.sprint,
    minor: issue.minor,
    defer_until: issue.defer_until ?? '',
    due_date: issue.due_date ?? '',
  }
}

const sameLabels = (a: string[], b: string[]) =>
  a.length === b.length && a.every((label, i) => label === b[i])

/**
 * The minimal PATCH body. A field equal to the stored issue is omitted, which
 * is what makes "omitted fields stay unchanged" true by construction rather
 * than by discipline.
 *
 * Clearing is deliberately never `null`: td reads a null on defer_until,
 * due_date or parent_id as "field absent" and leaves the value alone. Only an
 * empty string clears. points inverts this — it clears with 0, and an empty
 * string fails as a JSON type error with no field details to bind to.
 */
export function diffIssue(original: Issue, draft: IssueDraft): IssuePatch {
  const patch: IssuePatch = {}

  if (draft.title !== original.title) patch.title = draft.title
  if (draft.description !== original.description) patch.description = draft.description
  if (draft.acceptance !== original.acceptance) patch.acceptance = draft.acceptance
  if (draft.type !== original.type) patch.type = draft.type
  if (draft.priority !== original.priority) patch.priority = draft.priority
  if (draft.sprint !== original.sprint) patch.sprint = draft.sprint
  if (draft.minor !== original.minor) patch.minor = draft.minor
  if (!sameLabels(draft.labels, original.labels)) patch.labels = draft.labels

  // A NaN would serialise to null, which td silently ignores — so an
  // unparseable entry counts as no change rather than as a lost edit.
  const points = draft.points ?? 0
  if (points !== original.points && Number.isFinite(points)) patch.points = points

  if (draft.parent_id !== (original.parent_id ?? '')) patch.parent_id = draft.parent_id
  if (draft.defer_until !== (original.defer_until ?? '')) patch.defer_until = draft.defer_until
  if (draft.due_date !== (original.due_date ?? '')) patch.due_date = draft.due_date

  return patch
}

/** An empty patch means the form closes without issuing a request at all. */
export const isEmptyPatch = (patch: IssuePatch) => Object.keys(patch).length === 0
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npm test -- --run issueDiff`
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add web/src/api/types.ts web/src/features/issues/issueDiff.ts web/src/features/issues/issueDiff.test.ts
git commit -m "feat(web): build the issue PATCH body from a draft diff

td treats null as a no-op on defer_until, due_date and parent_id, so
clearing sends an empty string. points inverts it: 0 clears and \"\"
fails as a type error with no field details.

Claude-Session: https://claude.ai/code/session_01XS469PFMwxSvQ2HeckpT93"
```

---

### Task 2: API hooks for the remaining writes

**Files:**
- Modify: `web/src/api/client.ts:70` (`apiSend` signature)
- Modify: `web/src/api/mutations.ts:78-84` (retype `useUpdateIssue`), then append
- Modify: `web/src/api/queries.ts` (append)

**Interfaces:**
- Consumes: `IssuePatch`, `LabelsResponse` from Task 1
- Produces: `useUpdateIssue(id): mutation<IssuePatch>`, `useDeleteIssue(id): mutation<void>`, `useDeleteComment(issueId): mutation<string>`, `useAddDependency(issueId): mutation<string>`, `useRemoveDependency(issueId): mutation<string>`, `useSetFocus(): mutation<string | null>`, `useLabels()`

- [ ] **Step 1: Widen `apiSend` to accept PUT**

`PUT /v1/focus` is the only PUT in td's surface, and the current union excludes it.

In `web/src/api/client.ts`, change line 70:

```ts
export function apiSend<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
```

- [ ] **Step 2: Retype `useUpdateIssue` and add the write hooks**

In `web/src/api/mutations.ts`, replace the existing `useUpdateIssue` (lines 78-84) with the block below, and add `IssuePatch` to the type import on line 4:

```ts
/**
 * A partial update. The body carries only edited fields — see issueDiff.ts for
 * how clearing is encoded, which is not what the field types suggest.
 */
export function useUpdateIssue(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: IssuePatch) => apiSend('PATCH', `/v1/issues/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: issueKeys.all }),
  })
}

/** A soft delete: the issue leaves the list but a direct GET still returns it. */
export function useDeleteIssue(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiSend('DELETE', `/v1/issues/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: issueKeys.all }),
  })
}

export function useDeleteComment(issueId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) =>
      apiSend('DELETE', `/v1/issues/${issueId}/comments/${commentId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: issueKeys.detail(issueId) }),
  })
}

/**
 * Dependency errors carry a message and no details.fields — "cannot add
 * dependency: would create circular dependency", "issue not found: td-zzzzzz".
 * Callers must show the message, not bind it to a field.
 */
export function useAddDependency(issueId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dependsOn: string) =>
      apiSend('POST', `/v1/issues/${issueId}/dependencies`, { depends_on: dependsOn }),
    onSuccess: () => qc.invalidateQueries({ queryKey: issueKeys.all }),
  })
}

export function useRemoveDependency(issueId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (depId: string) =>
      apiSend('DELETE', `/v1/issues/${issueId}/dependencies/${depId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: issueKeys.all }),
  })
}

/**
 * td exposes no GET for focus — /v1/focus answers 405 — so this sets and never
 * reads. The UI can acknowledge the request but must not claim to know which
 * issue is currently focused.
 */
export function useSetFocus() {
  return useMutation({
    mutationFn: (issueId: string | null) => apiSend('PUT', '/v1/focus', { issue_id: issueId }),
  })
}
```

- [ ] **Step 3: Add the labels query**

In `web/src/api/queries.ts`, add `LabelsResponse` to the type import and append:

```ts
export const labelKeys = { all: ['labels'] as const }

/** Backs label autocomplete. Labels are not validated by td. */
export function useLabels() {
  return useQuery({
    queryKey: labelKeys.all,
    queryFn: () => apiGet<LabelsResponse>('/v1/labels'),
  })
}
```

- [ ] **Step 4: Verify the project still type-checks and the suite is green**

Run: `cd web && npx tsc -b --noEmit && npm test -- --run`
Expected: no type errors; all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/api/client.ts web/src/api/mutations.ts web/src/api/queries.ts
git commit -m "feat(web): add delete, dependency, focus and labels hooks

useUpdateIssue was typed to four fields and imported nowhere; it now
carries the full IssuePatch. Focus sets only — td exposes no GET.

Claude-Session: https://claude.ai/code/session_01XS469PFMwxSvQ2HeckpT93"
```

---

### Task 3: ConfirmButton

Serves issue delete, comment delete and dependency remove.

**Files:**
- Create: `web/src/components/ConfirmButton.tsx`
- Test: `web/src/components/ConfirmButton.test.tsx`

**Interfaces:**
- Produces: `ConfirmButton` (default export) with props `{ label: string; question: string; confirmLabel?: string; onConfirm: () => void; disabled?: boolean; className?: string }`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/ConfirmButton.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConfirmButton from './ConfirmButton'

describe('ConfirmButton', () => {
  it('does not fire on the first click', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmButton label="Delete" question="Delete this issue?" onConfirm={onConfirm} />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText('Delete this issue?')).toBeInTheDocument()
  })

  it('fires once the confirm is clicked', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmButton label="Delete" question="Delete this issue?" onConfirm={onConfirm} />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('restores the trigger on cancel without firing', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmButton label="Delete" question="Delete this issue?" onConfirm={onConfirm} />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.queryByText('Delete this issue?')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npm test -- --run ConfirmButton`
Expected: FAIL — `Failed to resolve import "./ConfirmButton"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/components/ConfirmButton.tsx`:

```tsx
import { useState } from 'react'

interface Props {
  label: string
  question: string
  /** Accessible name of the confirm control. Defaults to `Confirm <label>`. */
  confirmLabel?: string
  onConfirm: () => void
  disabled?: boolean
  className?: string
}

/**
 * Two-step confirmation in place. The app has no modal layer, and
 * window.confirm blocks the event loop and cannot carry the design tokens, so
 * the trigger swaps for a question and a confirm/cancel pair where it stands —
 * the same inline pattern TransitionBar uses for actions needing extra input.
 */
export default function ConfirmButton({
  label, question, confirmLabel, onConfirm, disabled, className = '',
}: Props) {
  const [armed, setArmed] = useState(false)

  if (!armed) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setArmed(true)}
        className={`rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted disabled:opacity-40 ${className}`}
      >
        {label}
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[11px] text-ink-muted">{question}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setArmed(false)
          onConfirm()
        }}
        className="rounded-sm border border-danger/40 px-2.5 py-1 text-[11px] text-danger disabled:opacity-40"
      >
        {confirmLabel ?? `Confirm ${label.toLowerCase()}`}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted"
      >
        Cancel
      </button>
    </span>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npm test -- --run ConfirmButton`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ConfirmButton.tsx web/src/components/ConfirmButton.test.tsx
git commit -m "feat(web): add an inline two-step confirm control

Claude-Session: https://claude.ai/code/session_01XS469PFMwxSvQ2HeckpT93"
```

---

### Task 4: LabelInput

**Files:**
- Create: `web/src/features/issues/LabelInput.tsx`
- Test: `web/src/features/issues/LabelInput.test.tsx`

**Interfaces:**
- Consumes: `useLabels()` from Task 2
- Produces: `LabelInput` (default export) with props `{ value: string[]; onChange: (labels: string[]) => void }`

- [ ] **Step 1: Write the failing test**

Create `web/src/features/issues/LabelInput.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import LabelInput from './LabelInput'

const server = setupServer(
  http.get('/v1/labels', () =>
    HttpResponse.json({ ok: true, data: { default_workflow: 'standard', labels: ['alpha', 'beta'] } })),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderInput(value: string[], onChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <LabelInput value={value} onChange={onChange} />
    </QueryClientProvider>,
  )
  return onChange
}

describe('LabelInput', () => {
  it('adds a typed label', async () => {
    const onChange = renderInput(['alpha'])

    await userEvent.type(screen.getByLabelText('Labels'), 'gamma')
    await userEvent.click(screen.getByRole('button', { name: 'Add label' }))

    expect(onChange).toHaveBeenCalledWith(['alpha', 'gamma'])
  })

  it('removes a label by its chip', async () => {
    const onChange = renderInput(['alpha', 'beta'])

    await userEvent.click(screen.getByRole('button', { name: 'Remove label alpha' }))

    expect(onChange).toHaveBeenCalledWith(['beta'])
  })

  it('ignores a duplicate', async () => {
    const onChange = renderInput(['alpha'])

    await userEvent.type(screen.getByLabelText('Labels'), 'alpha')
    await userEvent.click(screen.getByRole('button', { name: 'Add label' }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('offers the project labels as suggestions', async () => {
    renderInput([])

    expect(await screen.findByRole('option', { name: 'alpha', hidden: true })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npm test -- --run LabelInput`
Expected: FAIL — `Failed to resolve import "./LabelInput"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/features/issues/LabelInput.tsx`:

```tsx
import { useState } from 'react'
import { useLabels } from '../../api/queries'

interface Props {
  value: string[]
  onChange: (labels: string[]) => void
}

/**
 * Chips plus a free-text add, suggesting labels already used in the project.
 * td does not validate labels — it accepted "has space" — so nothing here
 * rejects input either.
 */
export default function LabelInput({ value, onChange }: Props) {
  const [entry, setEntry] = useState('')
  const { data } = useLabels()

  const add = () => {
    const label = entry.trim()
    setEntry('')
    if (!label || value.includes(label)) return
    onChange([...value, label])
  }

  return (
    <div>
      <label htmlFor="label-entry" className="mb-1.5 block text-[11px] uppercase tracking-widest text-ink-muted">
        Labels
      </label>

      {value.length > 0 && (
        <ul className="mb-1.5 flex flex-wrap gap-1.5">
          {value.map(label => (
            <li key={label} className="flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 font-mono text-[11px]">
              <span>{label}</span>
              <button
                type="button"
                aria-label={`Remove label ${label}`}
                onClick={() => onChange(value.filter(l => l !== label))}
                className="text-ink-faint"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-1.5">
        <input
          id="label-entry"
          list="label-suggestions"
          value={entry}
          onChange={e => setEntry(e.target.value)}
          // Enter adds a label; without this it would submit the edit form.
          onKeyDown={e => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            add()
          }}
          className="flex-1 rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink"
        />
        <button
          type="button"
          onClick={add}
          className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted"
        >
          Add label
        </button>
      </div>

      <datalist id="label-suggestions">
        {data?.labels.map(label => <option key={label} value={label} />)}
      </datalist>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npm test -- --run LabelInput`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/issues/LabelInput.tsx web/src/features/issues/LabelInput.test.tsx
git commit -m "feat(web): add a label chip input with project suggestions

Claude-Session: https://claude.ai/code/session_01XS469PFMwxSvQ2HeckpT93"
```

---

### Task 5: IssueEditForm

**Files:**
- Create: `web/src/features/issues/IssueEditForm.tsx`
- Test: `web/src/features/issues/IssueEditForm.test.tsx`

**Interfaces:**
- Consumes: `draftFrom`, `diffIssue`, `isEmptyPatch`, `IssueDraft` (Task 1); `useUpdateIssue` (Task 2); `LabelInput` (Task 4); `fieldErrorFor`, `ApiError` from `web/src/api/client.ts`; `ErrorPanel` from `web/src/components/ErrorPanel.tsx`
- Produces: `IssueEditForm` (default export) with props `{ issue: Issue; onDone: () => void }`

- [ ] **Step 1: Write the failing test**

Create `web/src/features/issues/IssueEditForm.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import IssueEditForm from './IssueEditForm'
import type { Issue } from '../../api/types'

const issue: Issue = {
  id: 'td-6a0883', title: 'Probe issue for API shape', description: 'A description',
  status: 'open', type: 'feature', priority: 'P1', points: 5, labels: ['alpha'],
  parent_id: null, acceptance: '', sprint: '', implementer_session: null,
  creator_session: null, reviewer_session: null, review_requested_by_session: null,
  closed_by_session: null, created_at: '2026-08-14T15:01:46+02:00',
  updated_at: '2026-08-14T15:04:10+02:00', reviewed_at: null, closed_at: null,
  deleted_at: null, minor: false, created_branch: null, defer_until: null,
  due_date: '2026-09-01', defer_count: 0,
}

const server = setupServer(
  http.get('/v1/labels', () =>
    HttpResponse.json({ ok: true, data: { default_workflow: 'standard', labels: ['alpha'] } })),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderForm(onDone = vi.fn()) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <IssueEditForm issue={issue} onDone={onDone} />
    </QueryClientProvider>,
  )
  return onDone
}

describe('IssueEditForm', () => {
  it('sends only the field that changed', async () => {
    let body: unknown
    server.use(http.patch('/v1/issues/td-6a0883', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ ok: true, data: { issue } })
    }))
    renderForm()

    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'A brand new title for it')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(body).toEqual({ title: 'A brand new title for it' }))
  })

  it('clears a date with an empty string rather than null', async () => {
    let body: unknown
    server.use(http.patch('/v1/issues/td-6a0883', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ ok: true, data: { issue } })
    }))
    renderForm()

    await userEvent.clear(screen.getByLabelText('Due date'))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(body).toEqual({ due_date: '' }))
  })

  it('closes without a request when nothing was edited', async () => {
    // onUnhandledRequest: 'error' turns a stray PATCH into a failure.
    const onDone = renderForm()

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(onDone).toHaveBeenCalledOnce()
  })

  it("shows td's field error verbatim against the field", async () => {
    server.use(http.patch('/v1/issues/td-6a0883', () =>
      HttpResponse.json({
        ok: false,
        error: {
          code: 'validation_error', message: 'Validation failed',
          details: { fields: [{ field: 'title', rule: 'min_length', message: 'title too short (2 chars, min 15)' }] },
        },
      }, { status: 400 })))
    renderForm()

    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'ab')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('title too short (2 chars, min 15)')).toBeInTheDocument()
  })

  // td's JSON type errors are validation_error with no details.fields, so a
  // code check would swallow them. The predicate is "no fields", not "not a
  // validation error".
  it('shows a validation error carrying no fields in the panel', async () => {
    server.use(http.patch('/v1/issues/td-6a0883', () =>
      HttpResponse.json({
        ok: false,
        error: { code: 'validation_error', message: 'invalid JSON: cannot unmarshal string into field points of type int' },
      }, { status: 400 })))
    renderForm()

    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'Something long enough here')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText(/cannot unmarshal string into field points/)).toBeInTheDocument()
  })

  it('cancels without sending anything', async () => {
    const onDone = renderForm()

    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'Edited but abandoned title')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onDone).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npm test -- --run IssueEditForm`
Expected: FAIL — `Failed to resolve import "./IssueEditForm"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/features/issues/IssueEditForm.tsx`:

```tsx
import { useState } from 'react'
import { ApiError, fieldErrorFor } from '../../api/client'
import { useUpdateIssue } from '../../api/mutations'
import type { Issue, IssueType, Priority } from '../../api/types'
import ErrorPanel from '../../components/ErrorPanel'
import LabelInput from './LabelInput'
import { diffIssue, draftFrom, isEmptyPatch, type IssueDraft } from './issueDiff'

const types: IssueType[] = ['task', 'feature', 'bug', 'chore', 'epic']
const priorities: Priority[] = ['P0', 'P1', 'P2', 'P3', 'P4']

const fieldClass = 'w-full rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink'
const legendClass = 'mb-1.5 block text-[11px] uppercase tracking-widest text-ink-muted'

interface Props {
  issue: Issue
  onDone: () => void
}

/**
 * No client-side bounds anywhere: title length and the points enum are
 * per-project td config, so the server validates and this renders its answer.
 * The dates use type="date" because it emits td's YYYY-MM-DD exactly.
 */
export default function IssueEditForm({ issue, onDone }: Props) {
  // Seeded once, deliberately. useLiveUpdates invalidates the detail query on
  // every SSE event; re-syncing the draft would wipe whatever is being typed.
  const [draft, setDraft] = useState<IssueDraft>(() => draftFrom(issue))
  const update = useUpdateIssue(issue.id)

  function set<K extends keyof IssueDraft>(key: K, value: IssueDraft[K]) {
    setDraft(current => ({ ...current, [key]: value }))
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const patch = diffIssue(issue, draft)
    // Nothing changed — close rather than issue an empty PATCH.
    if (isEmptyPatch(patch)) {
      onDone()
      return
    }
    update.mutate(patch, { onSuccess: onDone })
  }

  // A validation error with no fields — td's JSON type errors — has nothing to
  // bind to, so it belongs in the panel rather than silently nowhere.
  const unboundError =
    update.error instanceof ApiError && update.error.fields.length === 0
      ? update.error.message
      : null

  return (
    <form className="mt-4 space-y-4 border-t border-line-subtle pt-4" onSubmit={submit}>
      <div>
        <label htmlFor="edit-title" className={legendClass}>Title</label>
        <input id="edit-title" value={draft.title}
          onChange={e => set('title', e.target.value)} className={fieldClass} />
        <FieldError error={update.error} field="title" />
      </div>

      <div>
        <label htmlFor="edit-description" className={legendClass}>Description</label>
        <textarea id="edit-description" rows={6} value={draft.description}
          onChange={e => set('description', e.target.value)} className={fieldClass} />
        <FieldError error={update.error} field="description" />
      </div>

      <div>
        <label htmlFor="edit-acceptance" className={legendClass}>Acceptance criteria</label>
        <textarea id="edit-acceptance" rows={4} value={draft.acceptance}
          onChange={e => set('acceptance', e.target.value)} className={fieldClass} />
        <FieldError error={update.error} field="acceptance" />
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div>
          <label htmlFor="edit-type" className={legendClass}>Type</label>
          <select id="edit-type" value={draft.type}
            onChange={e => set('type', e.target.value as IssueType)} className={fieldClass}>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <FieldError error={update.error} field="type" />
        </div>
        <div>
          <label htmlFor="edit-priority" className={legendClass}>Priority</label>
          <select id="edit-priority" value={draft.priority}
            onChange={e => set('priority', e.target.value as Priority)} className={fieldClass}>
            {priorities.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <FieldError error={update.error} field="priority" />
        </div>
        <div>
          {/* No min or max: the accepted values are td config, and it names
              them in the error when a value is rejected. */}
          <label htmlFor="edit-points" className={legendClass}>Points</label>
          <input id="edit-points" type="number" value={draft.points ?? ''}
            onChange={e => set('points', e.target.value === '' ? null : Number(e.target.value))}
            className={fieldClass} />
          <FieldError error={update.error} field="points" />
        </div>
        <div>
          <label htmlFor="edit-sprint" className={legendClass}>Sprint</label>
          <input id="edit-sprint" value={draft.sprint}
            onChange={e => set('sprint', e.target.value)} className={fieldClass} />
          <FieldError error={update.error} field="sprint" />
        </div>
      </div>

      <div>
        <LabelInput value={draft.labels} onChange={labels => set('labels', labels)} />
        <FieldError error={update.error} field="labels" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="edit-parent" className={legendClass}>Parent</label>
          <input id="edit-parent" value={draft.parent_id} placeholder="td-…"
            onChange={e => set('parent_id', e.target.value)} className={fieldClass} />
          <FieldError error={update.error} field="parent_id" />
        </div>
        <div>
          <label htmlFor="edit-due" className={legendClass}>Due date</label>
          <input id="edit-due" type="date" value={draft.due_date}
            onChange={e => set('due_date', e.target.value)} className={fieldClass} />
          <FieldError error={update.error} field="due_date" />
        </div>
        <div>
          <label htmlFor="edit-defer" className={legendClass}>Defer until</label>
          <input id="edit-defer" type="date" value={draft.defer_until}
            onChange={e => set('defer_until', e.target.value)} className={fieldClass} />
          <FieldError error={update.error} field="defer_until" />
        </div>
      </div>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={draft.minor}
          onChange={e => set('minor', e.target.checked)} />
        <span>Minor — self-reviewable</span>
      </label>

      <div className="flex gap-1.5">
        <button type="submit" disabled={update.isPending}
          className="rounded-sm border border-accent px-3 py-1 text-[11px] text-accent disabled:opacity-40">
          Save changes
        </button>
        <button type="button" onClick={onDone}
          className="rounded-sm border border-line px-3 py-1 text-[11px] text-ink-muted">
          Cancel
        </button>
      </div>

      {unboundError && <ErrorPanel label="Update rejected" message={unboundError} />}
    </form>
  )
}

function FieldError({ error, field }: { error: unknown; field: string }) {
  const message = fieldErrorFor(error, field)
  if (!message) return null
  return <p className="mt-1.5 text-[11px] text-danger">{message}</p>
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npm test -- --run IssueEditForm`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/issues/IssueEditForm.tsx web/src/features/issues/IssueEditForm.test.tsx
git commit -m "feat(web): add the issue edit form

Every PATCH-able field is editable and the draft is seeded once, so an
SSE-driven refetch cannot wipe what is being typed. Unbound errors are
detected by an empty fields array, not by error code: td's JSON type
errors are validation_error and carry no fields.

Claude-Session: https://claude.ai/code/session_01XS469PFMwxSvQ2HeckpT93"
```

---

### Task 6: IssueActions and the edit toggle

**Files:**
- Create: `web/src/features/issues/IssueActions.tsx`
- Modify: `web/src/features/issues/IssueDetail.tsx:34-65` (header, edit toggle)
- Test: `web/src/features/issues/IssueDetail.test.tsx` (append cases)

**Interfaces:**
- Consumes: `useDeleteIssue`, `useSetFocus` (Task 2); `ConfirmButton` (Task 3); `IssueEditForm` (Task 5)
- Produces: `IssueActions` (default export) with props `{ issue: Issue; editing: boolean; onEdit: () => void }`

- [ ] **Step 1: Write the failing tests**

Append to `web/src/features/issues/IssueDetail.test.tsx`, inside the existing `describe('IssueDetail', …)`. The file already defines `server`, `detail` and `renderDetail`. Add these imports at the top if absent: `waitFor` from `@testing-library/react`.

```tsx
  it('deletes the issue after a confirmation and leaves the detail view', async () => {
    let deleted = false
    server.use(
      http.get('/v1/issues/td-6a0883', () => HttpResponse.json({ ok: true, data: detail })),
      http.delete('/v1/issues/td-6a0883', () => {
        deleted = true
        return HttpResponse.json({ ok: true, data: { deleted: true } })
      }),
      http.get('/v1/issues', () => HttpResponse.json({
        ok: true, data: { issues: [], limit: 50, offset: 0, total: 0, has_more: false },
      })),
    )
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(deleted).toBe(true))
  })

  it('sets focus and acknowledges the request without claiming to read it', async () => {
    let body: unknown
    server.use(
      http.get('/v1/issues/td-6a0883', () => HttpResponse.json({ ok: true, data: detail })),
      http.put('/v1/focus', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ ok: true, data: { focused_issue_id: 'td-6a0883' } })
      }),
    )
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: 'Focus' }))

    await waitFor(() => expect(body).toEqual({ issue_id: 'td-6a0883' }))
    expect(await screen.findByText('focus set')).toBeInTheDocument()
  })

  it('opens the edit form seeded with the current values', async () => {
    server.use(http.get('/v1/issues/td-6a0883', () => HttpResponse.json({ ok: true, data: detail })))
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))

    expect(screen.getByLabelText('Title')).toHaveValue('Probe issue for API shape')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npm test -- --run IssueDetail`
Expected: FAIL — no `Delete`, `Focus` or `Edit` button found.

- [ ] **Step 3: Write IssueActions**

Create `web/src/features/issues/IssueActions.tsx`:

```tsx
import { useNavigate } from 'react-router'
import { ApiError } from '../../api/client'
import { useDeleteIssue, useSetFocus } from '../../api/mutations'
import type { Issue } from '../../api/types'
import ConfirmButton from '../../components/ConfirmButton'
import ErrorPanel from '../../components/ErrorPanel'

interface Props {
  issue: Issue
  editing: boolean
  onEdit: () => void
}

export default function IssueActions({ issue, editing, onEdit }: Props) {
  const navigate = useNavigate()
  const remove = useDeleteIssue(issue.id)
  const focus = useSetFocus()

  const error = remove.error ?? focus.error

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink"
        >
          {editing ? 'Close editor' : 'Edit'}
        </button>

        <button
          type="button"
          disabled={focus.isPending}
          onClick={() => focus.mutate(issue.id)}
          className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted disabled:opacity-40"
        >
          Focus
        </button>

        {/* An acknowledgement of the request, not a reading of focus state:
            td exposes no GET for it, so the GUI cannot know what is focused. */}
        {focus.isSuccess && <span className="text-[11px] text-success">focus set</span>}

        <ConfirmButton
          label="Delete"
          question="Delete this issue?"
          disabled={remove.isPending}
          // Soft delete. The detail route would otherwise keep rendering an
          // issue that a direct GET still returns.
          onConfirm={() => remove.mutate(undefined, { onSuccess: () => navigate('/') })}
        />
      </div>

      {error && (
        <div className="mt-2">
          <ErrorPanel
            label="Action rejected"
            message={error instanceof ApiError ? error.message : String(error)}
          />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Wire the toggle into IssueDetail**

In `web/src/features/issues/IssueDetail.tsx`:

Add to the imports:

```tsx
import { useState } from 'react'
import IssueActions from './IssueActions'
import IssueEditForm from './IssueEditForm'
```

Add the state as the first line of the component body, above `const { id = '' } = useParams()`:

```tsx
  const [editing, setEditing] = useState(false)
```

After the `</header>` closing tag (currently line 54), insert:

```tsx
      <IssueActions issue={issue} editing={editing} onEdit={() => setEditing(!editing)} />

      {editing && <IssueEditForm issue={issue} onDone={() => setEditing(false)} />}
```

Then guard the read-only description so it does not duplicate the form. Replace the existing description section (currently lines 58-65) with:

```tsx
      {!editing && issue.description && (
        <section className="mt-6">
          <h2 className="mb-2 text-[11px] uppercase tracking-widest text-ink-muted">Description</h2>
          <p className="max-w-[68ch] whitespace-pre-wrap leading-relaxed">
            {issue.description}
          </p>
        </section>
      )}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npm test -- --run IssueDetail`
Expected: PASS — the three new cases plus every pre-existing one.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/issues/IssueActions.tsx web/src/features/issues/IssueDetail.tsx web/src/features/issues/IssueDetail.test.tsx
git commit -m "feat(web): reach edit, focus and delete from the detail view

Focus acknowledges the request rather than showing focus state: td
answers 405 on GET /v1/focus, so the GUI cannot know what is focused.

Claude-Session: https://claude.ai/code/session_01XS469PFMwxSvQ2HeckpT93"
```

---

### Task 7: DependencyPanel

Bare id rows. td-7a8b61 later enriches them with titles and statuses.

**Files:**
- Create: `web/src/features/issues/DependencyPanel.tsx`
- Modify: `web/src/features/issues/IssueDetail.tsx:32` (destructure `dependencies`), plus one render site
- Test: `web/src/features/issues/DependencyPanel.test.tsx`

**Interfaces:**
- Consumes: `useAddDependency`, `useRemoveDependency` (Task 2); `ConfirmButton` (Task 3); `Dependency` from `web/src/api/types.ts`
- Produces: `DependencyPanel` (default export) with props `{ issueId: string; dependencies: Dependency[] }`

- [ ] **Step 1: Write the failing test**

Create `web/src/features/issues/DependencyPanel.test.tsx`:

```tsx
import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import DependencyPanel from './DependencyPanel'
import type { Dependency } from '../../api/types'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const dependency: Dependency = {
  dep_id: 'dep_f7585e15', issue_id: 'td-6a0883',
  depends_on_id: 'td-ffe762', relation_type: 'depends_on',
}

function renderPanel(dependencies: Dependency[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DependencyPanel issueId="td-6a0883" dependencies={dependencies} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('DependencyPanel', () => {
  it('posts depends_on when a dependency is added', async () => {
    let body: unknown
    server.use(http.post('/v1/issues/td-6a0883/dependencies', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ ok: true, data: { dependency } })
    }))
    renderPanel([])

    await userEvent.type(screen.getByLabelText('Depends on'), 'td-ffe762')
    await userEvent.click(screen.getByRole('button', { name: 'Add dependency' }))

    await waitFor(() => expect(body).toEqual({ depends_on: 'td-ffe762' }))
  })

  // These errors carry no details.fields, so binding them to a field would
  // show nothing at all.
  it("shows td's circular-dependency message verbatim", async () => {
    server.use(http.post('/v1/issues/td-6a0883/dependencies', () =>
      HttpResponse.json({
        ok: false,
        error: { code: 'validation_error', message: 'cannot add dependency: would create circular dependency' },
      }, { status: 400 })))
    renderPanel([])

    await userEvent.type(screen.getByLabelText('Depends on'), 'td-6a0883')
    await userEvent.click(screen.getByRole('button', { name: 'Add dependency' }))

    expect(await screen.findByText('cannot add dependency: would create circular dependency')).toBeInTheDocument()
  })

  it('removes a dependency by dep_id after confirming', async () => {
    let removed = ''
    server.use(http.delete('/v1/issues/td-6a0883/dependencies/:depId', ({ params }) => {
      removed = String(params.depId)
      return HttpResponse.json({ ok: true, data: { removed: true } })
    }))
    renderPanel([dependency])

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm remove' }))

    await waitFor(() => expect(removed).toBe('dep_f7585e15'))
  })

  it('renders nothing but the add control when there are no dependencies', () => {
    renderPanel([])
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npm test -- --run DependencyPanel`
Expected: FAIL — `Failed to resolve import "./DependencyPanel"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/features/issues/DependencyPanel.tsx`:

```tsx
import { useState } from 'react'
import { Link } from 'react-router'
import { ApiError } from '../../api/client'
import { useAddDependency, useRemoveDependency } from '../../api/mutations'
import type { Dependency } from '../../api/types'
import ConfirmButton from '../../components/ConfirmButton'
import ErrorPanel from '../../components/ErrorPanel'

interface Props {
  issueId: string
  dependencies: Dependency[]
}

/**
 * Bare ids on purpose. The API returns only id triples, so titles and statuses
 * need a follow-up read of each referenced issue — that is td-7a8b61's work,
 * and this panel is written to be enriched rather than replaced.
 */
export default function DependencyPanel({ issueId, dependencies }: Props) {
  const [entry, setEntry] = useState('')
  const add = useAddDependency(issueId)
  const remove = useRemoveDependency(issueId)

  const error = add.error ?? remove.error

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[11px] uppercase tracking-widest text-ink-muted">
        Depends on ({dependencies.length})
      </h2>

      {dependencies.length > 0 && (
        <ul className="mb-2">
          {dependencies.map(dependency => (
            <li
              key={dependency.dep_id}
              className="flex items-center gap-2.5 border-b border-line-subtle py-1.5 last:border-b-0"
            >
              <Link
                to={`/issues/${dependency.depends_on_id}`}
                className="flex-1 font-mono text-[11px] text-accent"
              >
                {dependency.depends_on_id}
              </Link>
              <ConfirmButton
                label="Remove"
                question="Remove this dependency?"
                disabled={remove.isPending}
                onConfirm={() => remove.mutate(dependency.dep_id)}
              />
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex gap-1.5"
        onSubmit={event => {
          event.preventDefault()
          const id = entry.trim()
          if (!id) return
          add.mutate(id, { onSuccess: () => setEntry('') })
        }}
      >
        <label htmlFor="dependency-entry" className="sr-only">Depends on</label>
        <input
          id="dependency-entry"
          value={entry}
          placeholder="td-…"
          onChange={event => setEntry(event.target.value)}
          className="flex-1 rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 font-mono text-ink"
        />
        <button
          type="submit"
          disabled={add.isPending}
          className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted disabled:opacity-40"
        >
          Add dependency
        </button>
      </form>

      {error && (
        // No details.fields on these — "would create circular dependency",
        // "issue not found: td-zzzzzz" — so the message is all there is.
        <div className="mt-2">
          <ErrorPanel
            label="Dependency rejected"
            message={error instanceof ApiError ? error.message : String(error)}
          />
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Render it from IssueDetail**

In `web/src/features/issues/IssueDetail.tsx`, add `dependencies` to the destructure on line 32:

```tsx
  const { issue, logs, comments, dependencies, latest_handoff } = data
```

Insert the panel directly above the `Activity` section:

```tsx
      <DependencyPanel issueId={issue.id} dependencies={dependencies} />
```

and add the import:

```tsx
import DependencyPanel from './DependencyPanel'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npm test -- --run DependencyPanel IssueDetail`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/issues/DependencyPanel.tsx web/src/features/issues/DependencyPanel.test.tsx web/src/features/issues/IssueDetail.tsx
git commit -m "feat(web): add and remove dependencies from the detail view

Rows carry bare ids; td-7a8b61 enriches them with titles and statuses.
Dependency errors carry no details.fields, so the message is rendered
verbatim in a panel rather than bound to the input.

Claude-Session: https://claude.ai/code/session_01XS469PFMwxSvQ2HeckpT93"
```

---

### Task 8: Comment delete

**Files:**
- Modify: `web/src/features/issues/IssueDetail.tsx:89-109` (comment list)
- Test: `web/src/features/issues/IssueDetail.test.tsx` (append one case)

**Interfaces:**
- Consumes: `useDeleteComment` (Task 2); `ConfirmButton` (Task 3)

- [ ] **Step 1: Write the failing test**

Append inside `describe('IssueDetail', …)` in `web/src/features/issues/IssueDetail.test.tsx`:

```tsx
  it('deletes a comment after confirming', async () => {
    let deleted = ''
    server.use(
      http.get('/v1/issues/td-6a0883', () => HttpResponse.json({ ok: true, data: detail })),
      http.delete('/v1/issues/td-6a0883/comments/:commentId', ({ params }) => {
        deleted = String(params.commentId)
        return HttpResponse.json({ ok: true, data: { deleted: true } })
      }),
    )
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: 'Delete comment' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete comment' }))

    await waitFor(() => expect(deleted).toBe('cm-1f0a2b3c'))
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npm test -- --run IssueDetail`
Expected: FAIL — no `Delete comment` button found.

- [ ] **Step 3: Write the implementation**

In `web/src/features/issues/IssueDetail.tsx`, add the import:

```tsx
import { useDeleteComment } from '../../api/mutations'
```

Add the hook next to the existing `editing` state:

```tsx
  const deleteComment = useDeleteComment(id)
```

Replace the header line inside each comment `<li>` so the confirm sits on the meta row:

```tsx
              <div className="mb-1.5 flex items-center gap-2 font-mono text-[11px] text-ink-faint">
                <span>session {shortSession(comment.session_id)}</span>
                <span>·</span>
                <span>{relativeTime(comment.created_at)}</span>
                <span className="ml-auto">
                  <ConfirmButton
                    label="Delete comment"
                    question="Delete this comment?"
                    disabled={deleteComment.isPending}
                    onConfirm={() => deleteComment.mutate(comment.id)}
                  />
                </span>
              </div>
```

and add the import:

```tsx
import ConfirmButton from '../../components/ConfirmButton'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npm test -- --run IssueDetail`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/issues/IssueDetail.tsx web/src/features/issues/IssueDetail.test.tsx
git commit -m "feat(web): delete comments from the detail view

Claude-Session: https://claude.ai/code/session_01XS469PFMwxSvQ2HeckpT93"
```

---

### Task 9: Contract tests for the clearing semantics

The highest-value test in the plan. `diffIssue` rests entirely on an undocumented asymmetry that the issue description got wrong; without this, a change in td silently breaks every clear operation.

**Files:**
- Modify: `test/contract/contract_test.go` (append)

**Interfaces:**
- Consumes: `newProject(t)`, `getJSON(t, url, into)`, `jsonBody(s)` — all already in the file

- [ ] **Step 1: Write the failing tests**

Append to `test/contract/contract_test.go`:

```go
// patchIssue sends a PATCH and returns the updated issue plus the status code.
func patchIssue(t *testing.T, front, id, body string) (map[string]any, int) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPatch, front+"/v1/issues/"+id,
		strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PATCH %s: %v", body, err)
	}
	defer resp.Body.Close()

	var envelope struct {
		Data struct {
			Issue map[string]any `json:"issue"`
		} `json:"data"`
		Error struct {
			Details struct {
				Fields []map[string]any `json:"fields"`
			} `json:"details"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode PATCH response: %v", err)
	}
	if resp.StatusCode >= 300 {
		return map[string]any{"__fields": len(envelope.Error.Details.Fields)}, resp.StatusCode
	}
	return envelope.Data.Issue, resp.StatusCode
}

// TestClearingContract pins the asymmetry web/src/features/issues/issueDiff.ts
// is built on: td reads a null on a nullable field as "field absent" and leaves
// the stored value alone, so only an empty string clears. If this ever flips,
// every clear in the GUI silently stops working — this test is what turns that
// into a failure.
func TestClearingContract(t *testing.T) {
	front, id := newProject(t)

	if _, status := patchIssue(t, front, id,
		`{"due_date":"2026-12-01","defer_until":"2026-11-01"}`); status != http.StatusOK {
		t.Fatalf("seeding dates: status = %d, want 200", status)
	}

	issue, _ := patchIssue(t, front, id, `{"due_date":null,"defer_until":null}`)
	if issue["due_date"] == nil || issue["defer_until"] == nil {
		t.Error("null cleared a date; the GUI sends \"\" to clear because null is a no-op")
	}

	issue, _ = patchIssue(t, front, id, `{"due_date":"","defer_until":""}`)
	if issue["due_date"] != nil {
		t.Errorf("due_date = %v after an empty string, want null", issue["due_date"])
	}
	if issue["defer_until"] != nil {
		t.Errorf("defer_until = %v after an empty string, want null", issue["defer_until"])
	}
}

// TestPointsContract pins the inverse rule for points: 0 clears, and an empty
// string is a JSON type error carrying no field errors to bind to.
func TestPointsContract(t *testing.T) {
	front, id := newProject(t)

	if _, status := patchIssue(t, front, id, `{"points":5}`); status != http.StatusOK {
		t.Fatalf("seeding points: status = %d, want 200", status)
	}

	issue, _ := patchIssue(t, front, id, `{"points":0}`)
	if points, ok := issue["points"].(float64); !ok || points != 0 {
		t.Errorf("points = %v after 0, want 0", issue["points"])
	}

	result, status := patchIssue(t, front, id, `{"points":""}`)
	if status != http.StatusBadRequest {
		t.Errorf("status = %d for an empty points, want 400", status)
	}
	if result["__fields"] != 0 {
		t.Errorf("empty points returned %v field errors, want 0 — the form must "+
			"send a number because there is nothing to bind this to", result["__fields"])
	}
}

// TestDependencyContract pins the write shape and the field-less error the
// dependency panel renders as a message.
func TestDependencyContract(t *testing.T) {
	front, id := newProject(t)

	resp, err := http.Post(front+"/v1/issues/"+id+"/dependencies",
		"application/json", jsonBody(`{"depends_on":"`+id+`"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d for a self-dependency, want 400", resp.StatusCode)
	}

	var body struct {
		Error struct {
			Message string `json:"message"`
			Details struct {
				Fields []map[string]any `json:"fields"`
			} `json:"details"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(body.Error.Message, "circular") {
		t.Errorf("message = %q, want td's circular-dependency wording", body.Error.Message)
	}
	if len(body.Error.Details.Fields) != 0 {
		t.Errorf("got %d field errors, want 0 — the panel renders the message, "+
			"not a field binding", len(body.Error.Details.Fields))
	}
}

// TestFocusContract pins that focus is write-only. A GET would let the detail
// view show which issue is focused; while it 405s, the GUI must not claim to
// know.
func TestFocusContract(t *testing.T) {
	front, id := newProject(t)

	req, err := http.NewRequest(http.MethodPut, front+"/v1/focus",
		strings.NewReader(`{"issue_id":"`+id+`"}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT /v1/focus status = %d, want 200", resp.StatusCode)
	}

	read, err := http.Get(front + "/v1/focus")
	if err != nil {
		t.Fatal(err)
	}
	defer read.Body.Close()
	if read.StatusCode == http.StatusOK {
		t.Error("GET /v1/focus now succeeds — the detail view can show focus state " +
			"instead of only acknowledging the write")
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `go test ./test/contract/ -run 'TestClearingContract|TestPointsContract|TestDependencyContract|TestFocusContract' -v`
Expected: FAIL — `undefined: patchIssue` until Step 1's helper compiles, then the assertions run against real td.

Confirm the run did **not** skip: `td` must be on PATH. `td --version` should print v0.57.0 or later. A `--- SKIP` means nothing was verified.

- [ ] **Step 3: Run the full suite**

Run: `make test`
Expected: lint clean, Go tests pass, frontend suite passes. Check the contract package for `--- SKIP` before trusting the result.

- [ ] **Step 4: Commit**

```bash
git add test/contract/contract_test.go
git commit -m "test: pin td's field-clearing and dependency error contract

null is a no-op on nullable fields and only an empty string clears;
points inverts it. issueDiff.ts is built on that asymmetry, and it is
undocumented, so a change in td must fail here rather than silently
break every clear in the GUI.

Claude-Session: https://claude.ai/code/session_01XS469PFMwxSvQ2HeckpT93"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: the diff function and its td semantics (Task 1), the API hooks including the `PUT` widening (Task 2), inline confirmation (Task 3), label autocomplete (Task 4), the form with its draft-seeded-once rule and two-shape error split (Task 5), the inline edit toggle plus focus and delete with navigation away from a soft-deleted issue (Task 6), dependencies as bare ids (Task 7), comment delete (Task 8), and the contract tests including the focus 405 (Task 9). Board placement is out of scope by decision, recorded in the spec.

**Placeholder scan.** No TBD, no "add error handling", no "similar to Task N". Every code step carries the code.

**Type consistency.** `IssueDraft.points` is `number | null` in Task 1 and consumed as `draft.points ?? ''` in Task 5's input and `draft.points ?? 0` in the diff. `diffIssue(original, draft)` keeps that argument order at both call sites. `ConfirmButton`'s default confirm label is `Confirm ${label.toLowerCase()}`, which is what Tasks 6, 7 and 8 query for: `Confirm delete`, `Confirm remove`, `Confirm delete comment`. `useDeleteComment` takes the comment id, `useRemoveDependency` takes the `dep_id`, and `useSetFocus` takes `string | null` — matching every call.

One gap found and fixed during review: Task 2 must widen `apiSend`'s method union to include `PUT`, or `useSetFocus` will not compile. It is now Step 1 of that task.
