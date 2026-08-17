# New issue form: the fields td accepts at creation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the "New issue" form every field POST /v1/issues honours, all of
it sent in the single POST that creates the issue.

**Architecture:** `IssueForm` stops holding four `useState` values and holds one
`IssueDraft` instead — the same type `IssueEditForm` uses, already exported from
`issueDiff.ts`. A new `issueCreate.ts` supplies `blankDraft()` and
`createBodyFrom(draft)`, the create-side counterpart to `diffIssue`: it omits
every empty value so td applies its own defaults. The fields render flat, in the
edit form's order and grid. `IssueEditForm.tsx` is not touched.

**Tech Stack:** React 19 + TypeScript, react-query, react-router, Tailwind,
vitest + @testing-library/react + msw for the frontend; Go standard library for
the contract test.

**Spec:** `docs/superpowers/specs/2026-08-17-issue-create-form-fields-design.md`

## Global Constraints

- **English only.** UI strings, comments, commit messages, test names. The one
  exception is error text from td, which is displayed verbatim and never
  rewritten.
- **No client-side bounds.** No `min`/`max` on points, no `maxLength` on title,
  no date range. Title length and the points enum are per-project td config;
  the server validates and the form renders td's answer.
- **Dates are `type="date"`**, because it emits td's `YYYY-MM-DD` exactly.
- **Empty values are omitted from the POST body**, never sent as empty strings.
- **Commits** are Conventional Commits with a package scope: `feat(web):`,
  `test:`, `docs:`.
- **Frontend commands run from `web/`.** Use `npm test -- --run` (bare
  `npm test` watches in a TTY). Single file: `npm test -- --run IssueForm`.
- **Verification:** `make test` from the repo root lints first, so a lint or
  `tsc` failure stops the run before any test executes.
- **Dependencies at creation are out of scope** — see the spec's closing
  decision. Do not add a dependency picker to this form.

---

### Task 1: The create body mapper

The pure part, with no UI attached: the wider `IssueInput` and the two functions
that turn a draft into a POST body.

**Files:**
- Modify: `web/src/api/mutations.ts:88-93` (the `IssueInput` interface)
- Create: `web/src/features/issues/issueCreate.ts`
- Test: `web/src/features/issues/issueCreate.test.ts`

**Interfaces:**
- Consumes: `IssueDraft` from `./issueDiff` (existing export — do not redefine
  it), `IssueType` and `Priority` from `../../api/types`.
- Produces: `blankDraft(): IssueDraft` and
  `createBodyFrom(draft: IssueDraft): IssueInput`, both used by Task 2.
  `IssueInput` gains the eight optional fields listed below.

- [ ] **Step 1: Write the failing test**

Create `web/src/features/issues/issueCreate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { blankDraft, createBodyFrom } from './issueCreate'

const title = 'A sufficiently long issue title'

describe('createBodyFrom', () => {
  // The quick path: title, submit. Everything the user did not fill has to be
  // absent rather than empty, so td applies its own defaults instead of
  // storing our blanks.
  it('sends only title, type and priority for an untouched draft', () => {
    expect(createBodyFrom({ ...blankDraft(), title }))
      .toEqual({ title, type: 'task', priority: 'P2' })
  })

  it('carries every field the endpoint honours', () => {
    expect(createBodyFrom({
      title,
      description: 'a description',
      acceptance: 'it works',
      type: 'feature',
      priority: 'P1',
      points: 5,
      sprint: 'sprint-1',
      labels: ['alpha', 'beta'],
      parent_id: 'td-a1b2c3',
      due_date: '2026-09-01',
      defer_until: '2026-08-20',
      minor: true,
    })).toEqual({
      title,
      description: 'a description',
      acceptance: 'it works',
      type: 'feature',
      priority: 'P1',
      points: 5,
      sprint: 'sprint-1',
      labels: ['alpha', 'beta'],
      parent_id: 'td-a1b2c3',
      due_date: '2026-09-01',
      defer_until: '2026-08-20',
      minor: true,
    })
  })

  // An unparseable entry reaches the draft as NaN, which would serialise to
  // null — the same reason diffIssue drops it rather than sending it.
  it('omits points that are not a finite number', () => {
    expect(createBodyFrom({ ...blankDraft(), title, points: NaN }))
      .not.toHaveProperty('points')
  })

  // 0 is a value the user typed, not an empty field, so it goes out.
  it('sends points of 0', () => {
    expect(createBodyFrom({ ...blankDraft(), title, points: 0 }).points).toBe(0)
  })

  it('omits minor when it is not checked', () => {
    expect(createBodyFrom({ ...blankDraft(), title })).not.toHaveProperty('minor')
  })

  it('omits an empty label list', () => {
    expect(createBodyFrom({ ...blankDraft(), title, labels: [] }))
      .not.toHaveProperty('labels')
  })
})

describe('blankDraft', () => {
  it('starts on td-gui\'s visible defaults', () => {
    expect(blankDraft()).toEqual({
      title: '', description: '', acceptance: '', type: 'task', priority: 'P2',
      points: null, labels: [], parent_id: '', sprint: '', minor: false,
      defer_until: '', due_date: '',
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `web/`: `npm test -- --run issueCreate`
Expected: FAIL — `Failed to resolve import "./issueCreate"`.

- [ ] **Step 3: Widen `IssueInput`**

In `web/src/api/mutations.ts`, replace the interface at lines 88-93 with:

```ts
/**
 * A create body. Only `title` is required; every other field is omitted when
 * the form left it empty, so td applies its own defaults rather than storing
 * a blank — see issueCreate.ts. `depends_on` and `blocks` are deliberately
 * absent: td's CLI takes them at create time but this endpoint ignores them,
 * and dependencies are added from the detail view instead.
 */
export interface IssueInput {
  title: string
  description?: string
  acceptance?: string
  type?: IssueType
  priority?: Priority
  points?: number
  sprint?: string
  labels?: string[]
  parent_id?: string
  due_date?: string
  defer_until?: string
  minor?: boolean
}
```

- [ ] **Step 4: Write the mapper**

Create `web/src/features/issues/issueCreate.ts`:

```ts
import type { IssueInput } from '../../api/mutations'
import type { IssueDraft } from './issueDiff'

/** The form's starting state: nothing filled, on the defaults the selects show. */
export function blankDraft(): IssueDraft {
  return {
    title: '', description: '', acceptance: '', type: 'task', priority: 'P2',
    points: null, labels: [], parent_id: '', sprint: '', minor: false,
    defer_until: '', due_date: '',
  }
}

/**
 * The create body, and the counterpart to diffIssue: where that one omits what
 * has not changed, this omits what was never filled. td applies its own
 * defaults to an absent field, so an empty one must not go out as `""` — that
 * would store a blank the project's config had an opinion about.
 *
 * title, type and priority always go out. All three are visible in the form,
 * so sending them states what the reader can see; the rest are empty until
 * touched.
 */
export function createBodyFrom(draft: IssueDraft): IssueInput {
  const body: IssueInput = {
    title: draft.title,
    type: draft.type,
    priority: draft.priority,
  }

  if (draft.description) body.description = draft.description
  if (draft.acceptance) body.acceptance = draft.acceptance
  if (draft.sprint) body.sprint = draft.sprint
  if (draft.parent_id) body.parent_id = draft.parent_id
  if (draft.due_date) body.due_date = draft.due_date
  if (draft.defer_until) body.defer_until = draft.defer_until
  if (draft.labels.length > 0) body.labels = draft.labels
  if (draft.minor) body.minor = true

  // null is the empty input. A NaN — an unparseable entry — would serialise to
  // null and be read as "no value", so it is dropped rather than sent, the
  // same call diffIssue makes.
  if (draft.points !== null && Number.isFinite(draft.points)) body.points = draft.points

  return body
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run from `web/`: `npm test -- --run issueCreate`
Expected: PASS, 7 tests.

- [ ] **Step 6: Typecheck**

Run from the repo root: `make typecheck`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add web/src/api/mutations.ts web/src/features/issues/issueCreate.ts \
        web/src/features/issues/issueCreate.test.ts
git commit -m "feat(web): map a draft to the create body td actually accepts

IssueInput carried four of the twelve fields POST /v1/issues honours.
createBodyFrom is diffIssue's counterpart: it omits what was never filled,
so td applies its own defaults instead of storing our blanks."
```

---

### Task 2: The form holds a draft

A refactor with no visible change: same four fields, same requests, one state
object instead of four.

**Files:**
- Modify: `web/src/features/issues/IssueForm.tsx`
- Test: `web/src/features/issues/IssueForm.test.tsx`

**Interfaces:**
- Consumes: `blankDraft`, `createBodyFrom` from Task 1.
- Produces: a `draft` state and a `set(key, value)` updater inside `IssueForm`,
  which Tasks 3 and 4 add fields to.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('IssueForm', ...)` block in
`web/src/features/issues/IssueForm.test.tsx`:

```ts
  // The quick path this form exists for: a title and nothing else. An empty
  // field must be absent from the body, not sent as "" — td applies its own
  // default to a field the body omits, and stores the blank for one it carries.
  it('posts only the fields the user filled', async () => {
    let received: Record<string, unknown> | null = null
    server.use(http.post('/v1/issues', async ({ request }) => {
      received = await request.json() as Record<string, unknown>
      return HttpResponse.json({ ok: true, data: { issue: { id: 'td-new' } } })
    }))

    renderForm()
    await userEvent.type(screen.getByLabelText('Title'), 'A sufficiently long issue title')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await screen.findByText('issue detail stand-in')
    expect(received).toEqual({
      title: 'A sufficiently long issue title', type: 'task', priority: 'P2',
    })
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `web/`: `npm test -- --run IssueForm`
Expected: FAIL — the body is
`{title, description: undefined, type, priority}`; today's form spreads
`description: description || undefined`, and `JSON.stringify` drops the key, so
this may pass by accident. If it does pass, that is fine: it is the regression
guard for the rest of the task. Record which it was and continue.

- [ ] **Step 3: Swap the four states for one draft**

In `web/src/features/issues/IssueForm.tsx`, replace the imports and the four
`useState` calls. The file's top becomes:

```tsx
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { fieldErrorFor, unboundMessage } from '../../api/client'
import { useCreateIssue } from '../../api/mutations'
import type { IssueType, Priority } from '../../api/types'
import ErrorPanel from '../../components/ErrorPanel'
import { blankDraft, createBodyFrom } from './issueCreate'
import type { IssueDraft } from './issueDiff'

const types: IssueType[] = ['task', 'feature', 'bug', 'chore', 'epic']
const priorities: Priority[] = ['P0', 'P1', 'P2', 'P3', 'P4']

const fieldClass = 'w-full rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink'
const legendClass = 'mb-1.5 block text-[11px] uppercase tracking-widest text-ink-muted'

export default function IssueForm() {
  // One draft rather than a state per field, and the same shape the edit form
  // holds — the two forms offer the same fields, so they hold the same object.
  const [draft, setDraft] = useState<IssueDraft>(blankDraft)
  const create = useCreateIssue()
  const navigate = useNavigate()
  const panelError = unboundMessage(create.error, boundFields)

  function set<K extends keyof IssueDraft>(key: K, value: IssueDraft[K]) {
    setDraft(current => ({ ...current, [key]: value }))
  }
```

Keep the `submitting` ref and its comment exactly as they are.

- [ ] **Step 4: Send the mapped body**

In the same file, the `create.mutate` call becomes:

```tsx
        create.mutate(createBodyFrom(draft), {
          onSuccess: data => navigate(`/issues/${data.issue.id}`),
          onSettled: () => { submitting.current = false },
        })
```

And the four existing inputs read from the draft — `value={draft.title}` with
`onChange={e => set('title', e.target.value)}`, and the same for `description`,
`type` (`set('type', e.target.value as IssueType)`) and `priority`
(`set('priority', e.target.value as Priority)`).

- [ ] **Step 5: Run the whole file to verify nothing regressed**

Run from `web/`: `npm test -- --run IssueForm`
Expected: PASS, 6 tests — the five that existed plus the new one.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/issues/IssueForm.tsx web/src/features/issues/IssueForm.test.tsx
git commit -m "refactor(web): hold the new-issue form in one draft

Four useState calls do not scale to twelve fields. The draft is the same
shape the edit form holds, and the body now goes through createBodyFrom."
```

---

### Task 3: Acceptance, points and sprint

The three fields that need no new component: a textarea, a number input and a
text input, each with its own `FieldError` and its own `boundFields` entry.

**Files:**
- Modify: `web/src/features/issues/IssueForm.tsx`
- Test: `web/src/features/issues/IssueForm.test.tsx`

**Interfaces:**
- Consumes: `set`/`draft` from Task 2.
- Produces: labelled inputs `Acceptance criteria`, `Points` and `Sprint`;
  `boundFields` grown to `['title', 'description', 'acceptance', 'type',
  'priority', 'points', 'sprint']`.

- [ ] **Step 1: Write the failing test**

Append inside `describe('IssueForm', ...)`:

```ts
  it('sends acceptance, points and sprint in the create body', async () => {
    let received: Record<string, unknown> | null = null
    server.use(http.post('/v1/issues', async ({ request }) => {
      received = await request.json() as Record<string, unknown>
      return HttpResponse.json({ ok: true, data: { issue: { id: 'td-new' } } })
    }))

    renderForm()
    await userEvent.type(screen.getByLabelText('Title'), 'A sufficiently long issue title')
    await userEvent.type(screen.getByLabelText('Acceptance criteria'), 'it works')
    await userEvent.type(screen.getByLabelText('Points'), '5')
    await userEvent.type(screen.getByLabelText('Sprint'), 'sprint-1')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await screen.findByText('issue detail stand-in')
    expect(received).toEqual(expect.objectContaining({
      acceptance: 'it works', points: 5, sprint: 'sprint-1',
    }))
  })

  // The accepted point values are per-project td config, and td names them in
  // the error when it rejects one. A min or max here would eventually be wrong.
  it('puts no bounds on the points input', () => {
    renderForm()
    const points = screen.getByLabelText('Points')
    expect(points).not.toHaveAttribute('min')
    expect(points).not.toHaveAttribute('max')
  })

  // A field with a FieldError of its own must render td's message there and
  // not in the panel — the panel is for what nothing on screen has claimed.
  it('renders a points error at the points input', async () => {
    const message = 'invalid points: 4 (allowed: 1, 2, 3, 5, 8)'
    server.use(http.post('/v1/issues', () =>
      HttpResponse.json({
        ok: false,
        error: {
          code: 'validation_error',
          message: 'Validation failed',
          details: { fields: [{ field: 'points', rule: 'enum', value: 4, expected: '', message }] },
        },
      }, { status: 400 })))

    renderForm()
    await userEvent.type(screen.getByLabelText('Title'), 'A sufficiently long issue title')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findAllByText(message)).toHaveLength(1)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `web/`: `npm test -- --run IssueForm`
Expected: FAIL — `Unable to find a label with the text of: Acceptance criteria`.

- [ ] **Step 3: Render the three fields**

In `IssueForm.tsx`, put the acceptance textarea directly after the description
block, and replace the type/priority row with a four-column grid:

```tsx
      <div>
        <label htmlFor="new-acceptance" className={legendClass}>Acceptance criteria</label>
        <textarea
          id="new-acceptance" rows={4} value={draft.acceptance}
          onChange={e => set('acceptance', e.target.value)} className={fieldClass}
        />
        <FieldError error={create.error} field="acceptance" />
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div>
          <label htmlFor="new-type" className={legendClass}>Type</label>
          <select id="new-type" value={draft.type}
            onChange={e => set('type', e.target.value as IssueType)} className={fieldClass}>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <FieldError error={create.error} field="type" />
        </div>
        <div>
          <label htmlFor="new-priority" className={legendClass}>Priority</label>
          <select id="new-priority" value={draft.priority}
            onChange={e => set('priority', e.target.value as Priority)} className={fieldClass}>
            {priorities.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <FieldError error={create.error} field="priority" />
        </div>
        <div>
          {/* No min or max: the accepted values are td config, and it names
              them in the error when a value is rejected. */}
          <label htmlFor="new-points" className={legendClass}>Points</label>
          <input id="new-points" type="number" value={draft.points ?? ''}
            onChange={e => set('points', e.target.value === '' ? null : Number(e.target.value))}
            className={fieldClass} />
          <FieldError error={create.error} field="points" />
        </div>
        <div>
          <label htmlFor="new-sprint" className={legendClass}>Sprint</label>
          <input id="new-sprint" value={draft.sprint}
            onChange={e => set('sprint', e.target.value)} className={fieldClass} />
          <FieldError error={create.error} field="sprint" />
        </div>
      </div>
```

Also give the title and description blocks the shared classes — `className={legendClass}`
on their labels and `className={fieldClass}` on their inputs — and change their
`htmlFor`/`id` to `new-title` and `new-description` so every id in the form
carries the same prefix. Widen the form to `className="max-w-3xl space-y-4 px-5 py-4"`
so the four-column grid has room.

- [ ] **Step 4: Grow `boundFields`**

At the foot of the file:

```tsx
const boundFields = ['title', 'description', 'acceptance', 'type', 'priority', 'points', 'sprint']
```

- [ ] **Step 5: Run the tests to verify they pass**

Run from `web/`: `npm test -- --run IssueForm`
Expected: PASS, 9 tests. The existing "shows a field error this form does not
bind" test used `type` as its unbound example and will now FAIL, because `type`
has an input of its own. Fix it in place: change its message to
`'unknown status: opne'` and its `field` to `'status'` — a name this form has
no input for — and update the comment above it to say the form binds every
field it renders, so an error naming something else reaches the panel.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/issues/IssueForm.tsx web/src/features/issues/IssueForm.test.tsx
git commit -m "feat(web): accept acceptance, points and sprint at creation

Three of the eight fields that used to need a second round trip through
the edit form. Each binds td's message at its own input."
```

---

### Task 4: Labels, parent, dates and minor

The remaining five, two of which need the components the edit form already uses.

**Files:**
- Modify: `web/src/features/issues/IssueForm.tsx`
- Test: `web/src/features/issues/IssueForm.test.tsx`

**Interfaces:**
- Consumes: `LabelInput` (`./LabelInput`, props `value: string[]`,
  `onChange: (labels: string[]) => void` — it renders its own "Labels" label),
  `IssueCombobox` (`../../components/IssueCombobox`, props `id`, `value`,
  `onChange`, `candidates: Issue[]`, `placeholder`, `className`),
  `candidatesFor(issues, exclude)` from `./issueIndex`, `useIssueIndex()` from
  `./useIssueIndex`.
- Produces: `boundFields` complete at eleven names, consumed by Task 5.

- [ ] **Step 1: Give the test file the queries the new components make**

`LabelInput` calls `useLabels()` (GET `/v1/labels`) and `useIssueIndex()` calls
`useIssues()` twice (GET `/v1/issues`, once unfiltered and once for closed).
The suite runs with `onUnhandledRequest: 'error'`, so every existing test in
the file breaks the moment those components mount. Add default handlers to the
`setupServer()` call at the top of `IssueForm.test.tsx`:

```ts
const server = setupServer(
  http.get('/v1/labels', () =>
    HttpResponse.json({ ok: true, data: { default_workflow: 'standard', labels: ['alpha'] } })),
  http.get('/v1/issues', () => HttpResponse.json({
    ok: true, data: { issues: [], limit: 1000, offset: 0, total: 0, has_more: false },
  })),
)
```

- [ ] **Step 2: Write the failing test**

Append inside `describe('IssueForm', ...)`:

```ts
  it('sends labels, parent, both dates and minor in the create body', async () => {
    let received: Record<string, unknown> | null = null
    server.use(http.post('/v1/issues', async ({ request }) => {
      received = await request.json() as Record<string, unknown>
      return HttpResponse.json({ ok: true, data: { issue: { id: 'td-new' } } })
    }))

    renderForm()
    await userEvent.type(screen.getByLabelText('Title'), 'A sufficiently long issue title')
    await userEvent.type(screen.getByLabelText('Labels'), 'alpha')
    await userEvent.click(screen.getByRole('button', { name: 'Add label' }))
    await userEvent.type(screen.getByLabelText('Parent'), 'td-a1b2c3')
    // fireEvent, not userEvent.type: a date input takes a whole value, and
    // typing into one keystroke by keystroke does not produce a valid date.
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('Defer until'), { target: { value: '2026-08-20' } })
    await userEvent.click(screen.getByLabelText('Minor — self-reviewable'))
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await screen.findByText('issue detail stand-in')
    expect(received).toEqual(expect.objectContaining({
      labels: ['alpha'], parent_id: 'td-a1b2c3',
      due_date: '2026-09-01', defer_until: '2026-08-20', minor: true,
    }))
  })
```

- [ ] **Step 3: Run the test to verify it fails**

Run from `web/`: `npm test -- --run IssueForm`
Expected: FAIL — `Unable to find a label with the text of: Labels`.

- [ ] **Step 4: Render the five fields**

Add the imports:

```tsx
import IssueCombobox from '../../components/IssueCombobox'
import LabelInput from './LabelInput'
import { candidatesFor } from './issueIndex'
import { useIssueIndex } from './useIssueIndex'
```

Add the hook beside the others in the component body:

```tsx
  // The same query IssueList issues, so the parent picker is served from cache
  // rather than costing a request of its own.
  const { issues } = useIssueIndex()
```

And the markup, after the four-column grid:

```tsx
      <div>
        <LabelInput value={draft.labels} onChange={labels => set('labels', labels)} />
        <FieldError error={create.error} field="labels" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="new-parent" className={legendClass}>Parent</label>
          {/* Nothing to exclude: the issue does not exist yet, so it can be
              neither its own parent nor its own child. candidatesFor still
              earns its place by sorting closed issues last. */}
          <IssueCombobox id="new-parent" value={draft.parent_id}
            onChange={next => set('parent_id', next)}
            candidates={candidatesFor(issues, [])}
            placeholder="td-…" className={fieldClass} />
          <FieldError error={create.error} field="parent_id" />
        </div>
        <div>
          <label htmlFor="new-due" className={legendClass}>Due date</label>
          <input id="new-due" type="date" value={draft.due_date}
            onChange={e => set('due_date', e.target.value)} className={fieldClass} />
          <FieldError error={create.error} field="due_date" />
        </div>
        <div>
          <label htmlFor="new-defer" className={legendClass}>Defer until</label>
          <input id="new-defer" type="date" value={draft.defer_until}
            onChange={e => set('defer_until', e.target.value)} className={fieldClass} />
          <FieldError error={create.error} field="defer_until" />
        </div>
      </div>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={draft.minor}
          onChange={e => set('minor', e.target.checked)} />
        <span>Minor — self-reviewable</span>
      </label>
```

- [ ] **Step 5: Complete `boundFields`**

```tsx
/**
 * Every field with a <FieldError> of its own above. `minor` is deliberately
 * absent — it is the one field without one — so an error naming it, or naming
 * anything td renames later, falls through to the panel instead of rendering
 * nowhere.
 *
 * Exported so the suite can prove each entry really renders at an input: an
 * omission here only duplicates a message, but a stale entry silences one.
 * The same guard IssueEditForm.tsx carries, for the same reason.
 */
// oxlint-disable-next-line react/only-export-components
export const boundFields = [
  'title', 'description', 'acceptance', 'type', 'priority', 'points', 'sprint',
  'labels', 'parent_id', 'due_date', 'defer_until',
]
```

- [ ] **Step 6: Run the tests to verify they pass**

Run from `web/`: `npm test -- --run IssueForm`
Expected: PASS, 10 tests.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/issues/IssueForm.tsx web/src/features/issues/IssueForm.test.tsx
git commit -m "feat(web): accept labels, parent, dates and minor at creation

The last five fields POST /v1/issues honours. Labels and the parent picker
reuse the components the edit form already renders, so the two forms offer
the same widget for the same field."
```

---

### Task 5: Pin the two error shapes

The form is complete; this proves the messages land where they belong.

**Files:**
- Test: `web/src/features/issues/IssueForm.test.tsx`

**Interfaces:**
- Consumes: the `boundFields` export from Task 4.

- [ ] **Step 1: Write the failing tests**

Change the import at the top of the file to
`import IssueForm, { boundFields } from './IssueForm'`, then append a new
`describe` block at the end, outside `describe('IssueForm', ...)`:

```ts
// td returns not_found for a parent that does not exist, and — unlike its
// validation errors — that carries no details.fields. There is no input for
// it to bind to, so the panel is the only place it can be seen at all.
describe('IssueForm unbound errors', () => {
  it('renders a parent not_found in the panel', async () => {
    const message = 'parent issue not found: td-zzzzzz'
    server.use(http.post('/v1/issues', () =>
      HttpResponse.json({ ok: false, error: { code: 'not_found', message } },
        { status: 404 })))

    renderForm()
    await userEvent.type(screen.getByLabelText('Title'), 'A sufficiently long issue title')
    await userEvent.type(screen.getByLabelText('Parent'), 'td-zzzzzz')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findAllByText(message)).toHaveLength(1)
  })
})

/**
 * `boundFields` tells the panel which messages are already on screen, so a
 * name that no input actually renders re-creates the silence the shared
 * predicate exists to end. It is hand-maintained and cannot be derived — the
 * panel's value is computed during the parent's render, before any child
 * FieldError has run — so it is pinned here instead.
 *
 * Exactly once is the whole assertion, and it catches both directions: a stale
 * entry renders the message nowhere (0), and a field left off the list renders
 * it at the input and again in the panel (2).
 */
describe('IssueForm bound fields', () => {
  it.each(boundFields)('renders td\'s message for %s at its own input', async field => {
    const message = `${field} is not acceptable`
    server.use(http.post('/v1/issues', () =>
      HttpResponse.json({
        ok: false,
        error: {
          code: 'validation_error',
          message: 'Validation failed',
          details: { fields: [{ field, rule: 'invalid', value: '', expected: '', message }] },
        },
      }, { status: 400 })))

    renderForm()
    await userEvent.type(screen.getByLabelText('Title'), 'A sufficiently long issue title')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findAllByText(message)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the tests**

Run from `web/`: `npm test -- --run IssueForm`
Expected: PASS, 22 tests — 10 from before, the parent panel test, and eleven
from the `it.each`.

If any `boundFields` entry fails with a length of 0, its `FieldError` is
missing from the markup; if it fails with 2, the name is on the list but the
input is not rendering it. Fix the markup rather than the list — the list is
the assertion.

- [ ] **Step 3: Run the whole frontend suite**

Run from `web/`: `npm test -- --run`
Expected: PASS. `IssueEditForm` is untouched and must stay green.

- [ ] **Step 4: Commit**

```bash
git add web/src/features/issues/IssueForm.test.tsx web/src/features/issues/IssueForm.tsx
git commit -m "test(web): pin where each create error renders

A validation_error binds to its input, a parent not_found carries no
details.fields and reaches the panel. The boundFields guard proves every
name on the list has an input to render it."
```

---

### Task 6: The contract test

The frontend suite runs on msw and so proves nothing about td. This is what
pins that one POST really carries all of it.

**Files:**
- Modify: `test/contract/contract_test.go` (append at the end)

**Interfaces:**
- Consumes: `newProject(t) (frontURL, issueID string)`, `post(t, url, body) int`,
  `postJSON(t, url, body string, into any) int`,
  `otherIssue(t, front, notID string) string` and
  `getJSON(t, url string, into any)`, all existing helpers in that file.

- [ ] **Step 1: Write the failing test**

Append to `test/contract/contract_test.go`:

```go
// TestCreateFieldsContract pins that one POST /v1/issues carries every field
// the create form offers, so the GUI never needs a follow-up PATCH — the
// frontend suite runs against msw and can only prove what we told it to.
//
// It also pins the negative that scopes the form: depends_on is a td create
// flag that this endpoint ignores, which is why dependencies are added from
// the detail view instead.
func TestCreateFieldsContract(t *testing.T) {
	front, seeded := newProject(t)

	// An epic to hang the new issue off. Created first because parent_id has
	// to name an issue that already exists. The project holds exactly two
	// issues at this point — the one newProject seeded and this epic — so
	// otherIssue returns the epic.
	if status := post(t, front+"/v1/issues",
		`{"title":"Contract epic with a sufficiently long title","type":"epic"}`,
	); status != http.StatusCreated && status != http.StatusOK {
		t.Fatalf("create parent epic: status = %d", status)
	}
	parent := otherIssue(t, front, seeded)

	var created struct {
		Data struct {
			Issue map[string]any `json:"issue"`
		} `json:"data"`
	}
	body := `{"title":"Contract issue carrying every create field",` +
		`"description":"a description","acceptance":"it works",` +
		`"type":"feature","priority":"P1","points":5,"sprint":"sprint-1",` +
		`"labels":["alpha","beta"],"parent_id":"` + parent + `",` +
		`"due_date":"2026-09-01","defer_until":"2026-08-20","minor":true,` +
		`"depends_on":"` + parent + `"}`

	if status := postJSON(t, front+"/v1/issues", body, &created); status != http.StatusCreated &&
		status != http.StatusOK {
		t.Fatalf("create with every field: status = %d — if td started rejecting "+
			"one of these the create form sends a body it cannot accept", status)
	}

	issue := created.Data.Issue
	for field, want := range map[string]any{
		"title":       "Contract issue carrying every create field",
		"description": "a description",
		"acceptance":  "it works",
		"type":        "feature",
		"priority":    "P1",
		"points":      float64(5),
		"sprint":      "sprint-1",
		"parent_id":   parent,
		"due_date":    "2026-09-01",
		"defer_until": "2026-08-20",
		"minor":       true,
	} {
		if got := issue[field]; got != want {
			t.Errorf("%s = %v after create, want %v — a field the form sends in "+
				"the create body did not land, so it would need a PATCH", field, got, want)
		}
	}

	labels, _ := issue["labels"].([]any)
	if len(labels) != 2 || labels[0] != "alpha" || labels[1] != "beta" {
		t.Errorf("labels = %v after create, want [alpha beta]", issue["labels"])
	}

	// The scope decision, as an executable fact: if this ever starts failing,
	// dependencies at creation become worth revisiting.
	//
	// Read back through the detail endpoint rather than off the create
	// response: the create response is not required to carry `dependencies` at
	// all, and an absent field would make this assertion pass without ever
	// having looked at anything.
	id, ok := issue["id"].(string)
	if !ok {
		t.Fatalf("create response carried no id: %v", issue)
	}
	var detail struct {
		Data struct {
			Issue struct {
				Dependencies []any `json:"dependencies"`
			} `json:"issue"`
		} `json:"data"`
	}
	getJSON(t, front+"/v1/issues/"+id, &detail)
	if deps := detail.Data.Issue.Dependencies; len(deps) > 0 {
		t.Errorf("dependencies = %v after create — td now honours depends_on on "+
			"POST /v1/issues, so the create form could offer it", deps)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run from the repo root: `go test ./test/contract/ -run TestCreateFieldsContract -v`
Expected: FAIL — undefined behaviour is not the failure mode here; the test is
new and the code it exercises is td's, so it may well pass on the first run.
That is the point: it is a characterisation test. What must not happen is
`--- SKIP`, which means `td` is not on PATH and the test proved nothing.

- [ ] **Step 3: Fix whatever it reports**

If a field did not land, the create form must not claim to set it: remove it
from `createBodyFrom` and from the form, and record why in the spec's scope
section. If `parent_id` is rejected because td wants a different parent type,
adjust the seeded parent, not the assertion.

- [ ] **Step 4: Verify it runs rather than skips**

Run from the repo root: `go test ./test/contract/ -run TestCreateFieldsContract -v`
Expected: `--- PASS: TestCreateFieldsContract`. If it prints `--- SKIP`, install
td v0.57.0+ on PATH and run it again — a skipped contract test still prints
`ok` for the package and is worth nothing.

- [ ] **Step 5: Commit**

```bash
git add test/contract/contract_test.go
git commit -m "test(contract): pin that one POST carries every create field

The frontend suite runs on msw and proves only what we told it. This drives
a real td serve, and also pins that depends_on is ignored at create — the
reason dependencies stay a detail-view action."
```

---

### Task 7: Full verification and handoff

**Files:**
- Modify: `docs/superpowers/specs/2026-08-17-issue-create-form-fields-design.md`
  (only if Task 6 forced a scope change)

- [ ] **Step 1: Run the whole suite**

Run from the repo root: `make test`
Expected: golangci-lint clean, oxlint clean, `tsc -b` clean, `go test ./...` ok,
the frontend suite green.

- [ ] **Step 2: Confirm the contract package actually ran**

Run from the repo root: `go test ./test/contract/ -v 2>&1 | grep -c -- "--- SKIP"`
Expected: `0`. A non-zero count means `make test` was green on a package that
never executed.

- [ ] **Step 3: Build**

Run from the repo root: `make build`
Expected: exit 0, and `internal/web/dist/.gitkeep` still present
(`ls internal/web/dist/.gitkeep`).

- [ ] **Step 4: Look at the form in the running app**

Run the app and open `/issues/new`. Check that the four-column grid does not
overflow, that the parent picker opens, and that creating an issue with only a
title still lands on the new issue's detail view.

- [ ] **Step 5: Record the work in td**

```bash
td link td-e38efb web/src/features/issues/IssueForm.tsx \
  web/src/features/issues/issueCreate.ts web/src/api/mutations.ts \
  test/contract/contract_test.go
td handoff td-e38efb \
  --done "Create form offers all 12 POST /v1/issues fields, one POST, boundFields guard, contract test" \
  --remaining "Review" \
  --decision "Flat layout, no progressive disclosure; dependencies at creation out of scope — POST ignores depends_on and DependencyPanel is on the detail view create already lands on"
td review td-e38efb
```

- [ ] **Step 6: Commit anything left**

```bash
git status
```
Expected: clean. If the spec needed a scope amendment from Task 6, commit it as
`docs: record <field> as unsupported at creation`.
