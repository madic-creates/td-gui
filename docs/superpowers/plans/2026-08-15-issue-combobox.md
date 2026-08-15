# Searchable Issue Combobox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two raw `td-…` id inputs with a combobox that filters the
project's issues by id or title and shows each candidate's title and status.

**Architecture:** One presentational component,
`web/src/components/IssueCombobox.tsx`, renders an input plus a filtered
listbox and reports the typed or picked id through `onChange`. Candidate
selection and ordering live as a pure function `candidatesFor` in
`web/src/features/issues/issueIndex.ts`. Both call sites feed it from
`useIssueIndex()`, which already holds the whole issue list in the react-query
cache, so nothing new is fetched and no Go code changes.

**Tech Stack:** React 19, TypeScript, Tailwind v4 (CSS-variable tokens),
vitest + @testing-library/react + @testing-library/user-event, msw.

Spec: `docs/superpowers/specs/2026-08-15-issue-combobox-design.md`
td issue: td-409dce

## Global Constraints

- English only — UI strings, code, comments, commit messages. No i18n layer.
- No new npm dependency. `web/package.json` keeps exactly three runtime
  dependencies: react, react-dom, react-query, react-router.
- No Go changes, no new endpoint, no extra request: candidates come from
  `useIssueIndex()`, whose query is already in cache on the detail view.
- The frontend never validates ids. Free text stays submittable in both
  fields; td answers, and its message is displayed verbatim.
- Colors come from the token classes only (`border-line`, `bg-surface-raised`,
  `bg-surface-inset`, `bg-surface-hover`, `text-ink`, `text-ink-muted`,
  `text-ink-faint`). No raw hex, no `dark:` variants — the tokens flip
  themselves.
- Frontend tests run from `web/` as `npm test -- --run <file>`. Bare
  `npm test` watches.
- Commit style: Conventional Commits with a package scope — `feat(web):`,
  `test:`, `refactor:`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `web/src/features/issues/issueIndex.ts` (modify) | Add `candidatesFor` next to `indexById` / `resolve` / `isResolved`: which issues may be offered, and in what order. |
| `web/src/features/issues/issueIndex.test.ts` (modify) | Unit tests for `candidatesFor`. |
| `web/src/components/IssueCombobox.tsx` (create) | The widget: filtering, listbox rendering, mouse and keyboard selection, ARIA wiring. Knows nothing about react-query or mutations. |
| `web/src/components/IssueCombobox.test.tsx` (create) | Component tests, rendered standalone with a plain `candidates` array. |
| `web/src/features/issues/DependencyPanel.tsx` (modify, lines 32 and 66–82) | Feeds the combobox from `useIssueIndex().issues`, excluding itself and existing blockers. |
| `web/src/features/issues/DependencyPanel.test.tsx` (modify) | One case: pick a suggestion, submit, assert the posted id. |
| `web/src/features/issues/IssueEditForm.tsx` (modify, lines 166–171) | Same for the Parent field, excluding only the issue itself. |
| `web/src/features/issues/IssueEditForm.test.tsx` (modify) | Default `/v1/issues` handler plus one case: pick a parent, assert the patch. |

---

### Task 1: `candidatesFor`

**Files:**
- Modify: `web/src/features/issues/issueIndex.ts`
- Test: `web/src/features/issues/issueIndex.test.ts`

**Interfaces:**
- Consumes: `Issue` from `../../api/types`; `makeIssue` from
  `./issue.fixture` in the test.
- Produces: `candidatesFor(issues: Issue[], exclude: Iterable<string>): Issue[]`
  — used by Tasks 4 and 5.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/features/issues/issueIndex.test.ts`, and add
`candidatesFor` to the existing import from `./issueIndex` on line 2:

```ts
describe('candidatesFor', () => {
  it('drops every excluded id', () => {
    const self = makeIssue({ id: 'td-self' })
    const linked = makeIssue({ id: 'td-linked' })
    const free = makeIssue({ id: 'td-free' })

    expect(candidatesFor([self, linked, free], ['td-self', 'td-linked']))
      .toEqual([free])
  })

  // A dependency on a closed issue is legitimate — the panel has a "Resolved"
  // group for exactly that — so closed issues stay offerable, just last.
  it('sorts closed issues after the ones still open', () => {
    const done = makeIssue({ id: 'td-done', status: 'closed' })
    const doing = makeIssue({ id: 'td-doing', status: 'in_progress' })

    expect(candidatesFor([done, doing], [])).toEqual([doing, done])
  })

  it('keeps the incoming order within each group', () => {
    const first = makeIssue({ id: 'td-1' })
    const second = makeIssue({ id: 'td-2' })
    const oldest = makeIssue({ id: 'td-3', status: 'closed' })
    const newest = makeIssue({ id: 'td-4', status: 'closed' })

    expect(candidatesFor([first, oldest, second, newest], []))
      .toEqual([first, second, oldest, newest])
  })

  it('returns nothing for an empty list', () => {
    expect(candidatesFor([], ['td-self'])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `web/`: `npm test -- --run src/features/issues/issueIndex.test.ts`
Expected: FAIL — `candidatesFor is not a function` (or a TS error that it is
not exported).

- [ ] **Step 3: Implement it**

Append to `web/src/features/issues/issueIndex.ts`:

```ts
/**
 * The issues offerable as a link target: everything the index holds minus the
 * ids the caller rules out — the issue itself, and whatever it already links.
 *
 * Closed issues stay in the list because linking one is legitimate, but they
 * sort last: what a reader reaches for is nearly always still open. Within
 * each group the caller's order survives untouched.
 */
export function candidatesFor(issues: Issue[], exclude: Iterable<string>): Issue[] {
  const skip = new Set(exclude)
  const open: Issue[] = []
  const closed: Issue[] = []
  for (const issue of issues) {
    if (skip.has(issue.id)) continue
    if (issue.status === 'closed') closed.push(issue)
    else open.push(issue)
  }
  return [...open, ...closed]
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run from `web/`: `npm test -- --run src/features/issues/issueIndex.test.ts`
Expected: PASS, all `candidatesFor` cases plus the pre-existing `resolve`,
`childrenOf` and `isResolved` describes.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/issues/issueIndex.ts web/src/features/issues/issueIndex.test.ts
git commit -m "feat(web): select and order the issues a link field may offer"
```

---

### Task 2: `IssueCombobox` — filtering, rendering, mouse selection

**Files:**
- Create: `web/src/components/IssueCombobox.tsx`
- Test: `web/src/components/IssueCombobox.test.tsx`

**Interfaces:**
- Consumes: `Issue` from `../api/types`; `StatusTag` from `./StatusTag`;
  `makeIssue` from `../features/issues/issue.fixture` in the test.
- Produces: default export `IssueCombobox` with

  ```ts
  interface Props {
    id: string                       // input id, so callers keep their own <label>
    value: string
    onChange: (value: string) => void
    candidates: Issue[]
    placeholder?: string
    className?: string               // applied to the <input>, not the wrapper
  }
  ```

  and the named export `MAX_OPTIONS = 20`. Tasks 3, 4 and 5 build on this.

Note for the implementer: the wrapper `<div className="relative">` is always
just `relative`. Layout classes such as `flex-1` belong on a wrapper the
caller supplies — see Task 4.

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/IssueCombobox.test.tsx`:

```tsx
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IssueCombobox, { MAX_OPTIONS } from './IssueCombobox'
import { makeIssue } from '../features/issues/issue.fixture'

const candidates = [
  makeIssue({ id: 'td-a1b2c3', title: 'Defer the storage read', status: 'open' }),
  makeIssue({ id: 'td-d4e5f6', title: 'Share the relation heading', status: 'in_progress' }),
  makeIssue({ id: 'td-999999', title: 'Untrack node_modules', status: 'closed' }),
]

/**
 * Renders the field as its callers do: their own label, and state behind
 * `value`. The state is not decoration — the component is controlled, so a
 * fixed `value` would swallow every keystroke and no filter would ever run.
 */
function renderBox(initial = '', onChange = vi.fn()) {
  function Harness() {
    const [value, setValue] = useState(initial)
    return (
      <>
        <label htmlFor="pick">Depends on</label>
        <IssueCombobox
          id="pick"
          value={value}
          candidates={candidates}
          onChange={next => { setValue(next); onChange(next) }}
        />
      </>
    )
  }
  render(<Harness />)
  return { onChange, input: screen.getByLabelText('Depends on') }
}

describe('IssueCombobox', () => {
  it('offers every candidate with its id, title and status once focused', async () => {
    const { input } = renderBox()

    await userEvent.click(input)

    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(screen.getByText('td-a1b2c3')).toBeInTheDocument()
    expect(screen.getByText('Defer the storage read')).toBeInTheDocument()
    expect(screen.getByText('closed')).toBeInTheDocument()
  })

  // The point of the whole feature: people remember titles, not ids.
  it('filters by a substring of the title', async () => {
    const { input } = renderBox()

    await userEvent.click(input)
    await userEvent.type(input, 'storage')

    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByText('Defer the storage read')).toBeInTheDocument()
  })

  it('filters by a substring of the id', async () => {
    const { input } = renderBox()

    await userEvent.click(input)
    await userEvent.type(input, 'd4e5')

    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByText('Share the relation heading')).toBeInTheDocument()
  })

  it('matches case-insensitively and ignores surrounding blanks', async () => {
    const { input } = renderBox()

    await userEvent.click(input)
    await userEvent.type(input, '  UNTRACK ')

    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByText('Untrack node_modules')).toBeInTheDocument()
  })

  it('reports the picked id and closes the list', async () => {
    const { onChange, input } = renderBox()

    await userEvent.click(input)
    await userEvent.click(screen.getByText('Share the relation heading'))

    expect(onChange).toHaveBeenCalledWith('td-d4e5f6')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('reports what is typed as it is typed', async () => {
    const { onChange, input } = renderBox()

    await userEvent.type(input, 'td-')

    expect(onChange).toHaveBeenLastCalledWith('td-')
  })

  it('shows no list at all when nothing matches', async () => {
    const { input } = renderBox('td-nothing-like-this')

    await userEvent.click(input)

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false')
  })

  // A thousand issues would otherwise open a thousand rows. The cap is
  // visible rather than silent.
  it('renders at most MAX_OPTIONS rows and says how many it dropped', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      makeIssue({ id: `td-${i}`, title: `Issue number ${i}` }))
    const onChange = vi.fn()
    render(
      <>
        <label htmlFor="pick">Depends on</label>
        <IssueCombobox id="pick" value="" onChange={onChange} candidates={many} />
      </>,
    )

    await userEvent.click(screen.getByLabelText('Depends on'))

    expect(screen.getAllByRole('option')).toHaveLength(MAX_OPTIONS)
    expect(screen.getByText('20 of 25 matches — keep typing')).toBeInTheDocument()
  })

  it('says nothing about a cap when everything fits', async () => {
    const { input } = renderBox()

    await userEvent.click(input)

    expect(screen.queryByText(/keep typing/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `web/`: `npm test -- --run src/components/IssueCombobox.test.tsx`
Expected: FAIL — cannot resolve `./IssueCombobox`.

- [ ] **Step 3: Write the component**

Create `web/src/components/IssueCombobox.tsx`:

```tsx
import { useState } from 'react'
import type { Issue } from '../api/types'
import StatusTag from './StatusTag'

/** Rows past this stay unrendered, and the list says so rather than lying. */
export const MAX_OPTIONS = 20

interface Props {
  id: string
  value: string
  onChange: (value: string) => void
  candidates: Issue[]
  placeholder?: string
  className?: string
}

/** Substring, not prefix: "storage" should find a title that carries it. */
function matches(issue: Issue, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return issue.id.toLowerCase().includes(needle)
    || issue.title.toLowerCase().includes(needle)
}

/**
 * An issue picker over a list the caller already holds. Presentational on
 * purpose: it neither queries nor mutates, and reports the bare id through
 * `onChange`, so a caller's submit path cannot tell a typed id from a picked
 * one. Free text is never rejected here — the candidate list is capped at
 * td's 1000-issue page, so a valid id may simply not be in it, and only the
 * server is in a position to say.
 *
 * `className` styles the input; the wrapper stays `relative` so the listbox
 * can hang off it. Callers that need layout wrap the component themselves.
 */
export default function IssueCombobox({
  id, value, onChange, candidates, placeholder, className,
}: Props) {
  const [open, setOpen] = useState(false)

  const found = candidates.filter(issue => matches(issue, value))
  const shown = found.slice(0, MAX_OPTIONS)
  const expanded = open && shown.length > 0
  const listId = `${id}-listbox`

  const select = (issue: Issue) => {
    onChange(issue.id)
    setOpen(false)
  }

  return (
    <div className="relative">
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={event => { onChange(event.target.value); setOpen(true) }}
        className={className}
      />

      {expanded && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-0.5 max-h-64 w-full overflow-y-auto rounded-sm border border-line bg-surface-raised"
        >
          {shown.map(issue => (
            <li
              key={issue.id}
              role="option"
              aria-selected={false}
              // Blur would close the list before the click ever landed.
              onMouseDown={event => event.preventDefault()}
              onClick={() => select(issue)}
              className="flex cursor-pointer items-baseline gap-2 px-2.5 py-1.5"
            >
              <span className="font-mono text-[11px] text-ink-muted">{issue.id}</span>
              <span className="flex-1 truncate text-ink">{issue.title}</span>
              <StatusTag status={issue.status} />
            </li>
          ))}
          {found.length > shown.length && (
            <li role="presentation" className="px-2.5 py-1.5 text-[11px] text-ink-faint">
              {shown.length} of {found.length} matches — keep typing
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run from `web/`: `npm test -- --run src/components/IssueCombobox.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 5: Lint**

Run from `web/`: `npm run lint`
Expected: no findings for the new file.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/IssueCombobox.tsx web/src/components/IssueCombobox.test.tsx
git commit -m "feat(web): add a searchable issue picker component"
```

---

### Task 3: `IssueCombobox` — keyboard and ARIA

**Files:**
- Modify: `web/src/components/IssueCombobox.tsx`
- Test: `web/src/components/IssueCombobox.test.tsx`

**Interfaces:**
- Consumes: everything Task 2 produced. Props are unchanged.
- Produces: the same default export, now with arrow-key navigation, an
  `aria-activedescendant` pointing at the active row, Enter-selects, and an
  Escape that closes without clearing. Tasks 4 and 5 depend on Enter not
  submitting the surrounding form while the list is open.

- [ ] **Step 1: Write the failing tests**

Append these cases inside the existing `describe('IssueCombobox', …)` in
`web/src/components/IssueCombobox.test.tsx`:

```tsx
  // The first row is active as soon as the list opens, so two presses land on
  // the third candidate.
  it('moves the active row with the arrow keys and takes it with Enter', async () => {
    const { onChange, input } = renderBox()

    await userEvent.click(input)
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    await userEvent.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('td-999999')
  })

  it('points aria-activedescendant at the active row', async () => {
    const { input } = renderBox()

    await userEvent.click(input)
    await userEvent.keyboard('{ArrowDown}')

    const active = screen.getAllByRole('option')[1]
    expect(active).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', active.id)
  })

  it('stops at the ends of the list', async () => {
    const { onChange, input } = renderBox()

    await userEvent.click(input)
    await userEvent.keyboard('{ArrowUp}{ArrowUp}')
    await userEvent.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('td-a1b2c3')
  })

  // Both call sites sit inside a <form>. Picking a suggestion must not also
  // save the form.
  it('does not submit the surrounding form while the list is open', async () => {
    const onSubmit = vi.fn(event => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <label htmlFor="pick">Depends on</label>
        <IssueCombobox id="pick" value="" onChange={vi.fn()} candidates={candidates} />
      </form>,
    )
    const input = screen.getByLabelText('Depends on')

    await userEvent.click(input)
    await userEvent.keyboard('{ArrowDown}{Enter}')

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits the form on Enter once the list is closed', async () => {
    const onSubmit = vi.fn(event => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <label htmlFor="pick">Depends on</label>
        <IssueCombobox id="pick" value="" onChange={vi.fn()} candidates={candidates} />
      </form>,
    )
    const input = screen.getByLabelText('Depends on')

    await userEvent.click(input)
    await userEvent.keyboard('{Escape}')
    await userEvent.keyboard('{Enter}')

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape without clearing what was typed', async () => {
    const { onChange, input } = renderBox('stor')

    await userEvent.click(input)
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(input).toHaveValue('stor')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reopens the closed list with Arrow Down without selecting anything', async () => {
    const { onChange, input } = renderBox()

    await userEvent.click(input)
    await userEvent.keyboard('{Escape}')
    await userEvent.keyboard('{ArrowDown}')

    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('starts over at the first row when the query changes', async () => {
    const { onChange, input } = renderBox()

    await userEvent.click(input)
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.type(input, 'e')          // re-filters; the active row resets
    await userEvent.keyboard('{Enter}')

    expect(onChange).toHaveBeenLastCalledWith('td-a1b2c3')
  })
```

Note on the last case: typing `e` leaves all three candidates matching
(`Defer the storage read`, `Share the relation heading`, `Untrack
node_modules` — every title carries an `e`), so the reset is what decides
which row Enter takes.

- [ ] **Step 2: Run the tests to verify they fail**

Run from `web/`: `npm test -- --run src/components/IssueCombobox.test.tsx`
Expected: the 9 Task 2 tests PASS; the 8 new ones FAIL — no keyboard handler
exists, so `{Enter}` never calls `onChange` and `aria-activedescendant` is
absent.

- [ ] **Step 3: Add the keyboard handling**

In `web/src/components/IssueCombobox.tsx`, add an `active` state below the
existing `open` state:

```tsx
  const [open, setOpen] = useState(false)
  // Index into `shown`. Reset to 0 whenever the query changes, so Enter
  // always takes the row the reader is looking at rather than a leftover
  // position from a longer list.
  const [active, setActive] = useState(0)
```

Clamp it where `shown` is computed, so a shrinking list cannot leave the
index past the end:

```tsx
  const expanded = open && shown.length > 0
  const activeIndex = Math.min(active, shown.length - 1)
  const listId = `${id}-listbox`
  const optionId = (index: number) => `${listId}-option-${index}`
```

Reset it in `select` and add the key handler:

```tsx
  const select = (issue: Issue) => {
    onChange(issue.id)
    setOpen(false)
    setActive(0)
  }

  const keyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      // A closed list opens where it left off rather than jumping a row.
      if (!expanded) setOpen(true)
      else setActive(Math.min(activeIndex + 1, shown.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (expanded) setActive(Math.max(activeIndex - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      // The field sits inside a form at both call sites: taking a suggestion
      // must not also submit it. With the list closed, Enter is the form's.
      if (!expanded) return
      event.preventDefault()
      select(shown[activeIndex])
      return
    }
    if (event.key === 'Escape') {
      // The text survives — only the list closes.
      setOpen(false)
    }
  }
```

Wire it into the input, alongside the reset on typing:

```tsx
        onChange={event => { onChange(event.target.value); setOpen(true); setActive(0) }}
        onKeyDown={keyDown}
        aria-activedescendant={expanded ? optionId(activeIndex) : undefined}
```

And give each row its identity and highlight:

```tsx
          {shown.map((issue, index) => (
            <li
              key={issue.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={event => event.preventDefault()}
              onClick={() => select(issue)}
              className={`flex cursor-pointer items-baseline gap-2 px-2.5 py-1.5 ${
                index === activeIndex ? 'bg-surface-hover' : ''
              }`}
            >
```

- [ ] **Step 4: Run the tests to verify they pass**

Run from `web/`: `npm test -- --run src/components/IssueCombobox.test.tsx`
Expected: PASS, 17 tests.

- [ ] **Step 5: Lint**

Run from `web/`: `npm run lint`
Expected: no findings.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/IssueCombobox.tsx web/src/components/IssueCombobox.test.tsx
git commit -m "feat(web): drive the issue picker from the keyboard"
```

---

### Task 4: The dependency field uses it

**Files:**
- Modify: `web/src/features/issues/DependencyPanel.tsx` (line 32, lines 66–82)
- Test: `web/src/features/issues/DependencyPanel.test.tsx`

**Interfaces:**
- Consumes: `candidatesFor` (Task 1), `IssueCombobox` (Tasks 2–3),
  `useIssueIndex()` returning `{ index, issues }`.
- Produces: nothing new. The input keeps its `id="dependency-entry"` and its
  `Depends on` label, so the existing tests that type by label keep passing.

- [ ] **Step 1: Write the failing test**

Add to `web/src/features/issues/DependencyPanel.test.tsx`, inside the
`describe('DependencyPanel', …)`:

```tsx
  it('posts the id of a suggestion picked by title', async () => {
    server.use(http.get('/v1/issues', () => HttpResponse.json({
      ok: true,
      data: {
        issues: [makeIssue({ id: 'td-pick', title: 'The one to depend on' })],
        limit: 1000, offset: 0, total: 1, has_more: false,
      },
    })))
    let body: unknown
    server.use(http.post('/v1/issues/td-6a0883/dependencies', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ ok: true, data: { dependency } })
    }))
    renderPanel([])

    await userEvent.click(screen.getByLabelText('Depends on'))
    await userEvent.click(await screen.findByText('The one to depend on'))
    await userEvent.click(screen.getByRole('button', { name: 'Add dependency' }))

    await waitFor(() => expect(body).toEqual({ depends_on: 'td-pick' }))
  })

  // Adding either would only earn a rejection from td.
  it('offers neither the issue itself nor a blocker it already has', async () => {
    server.use(http.get('/v1/issues', () => HttpResponse.json({
      ok: true,
      data: {
        issues: [
          makeIssue({ id: 'td-6a0883', title: 'The issue being viewed' }),
          makeIssue({ id: 'td-ffe762', title: 'The blocker already linked' }),
          makeIssue({ id: 'td-free', title: 'Still linkable' }),
        ],
        limit: 1000, offset: 0, total: 3, has_more: false,
      },
    })))
    renderPanel([dependency])

    await userEvent.click(screen.getByLabelText('Depends on'))

    expect(await screen.findByRole('option')).toHaveTextContent('Still linkable')
    expect(screen.getAllByRole('option')).toHaveLength(1)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `web/`: `npm test -- --run src/features/issues/DependencyPanel.test.tsx`
Expected: both new cases FAIL — the plain input renders no options, so
`findByText('The one to depend on')` and `findByRole('option')` time out.

- [ ] **Step 3: Wire the combobox in**

In `web/src/features/issues/DependencyPanel.tsx`, add the imports:

```tsx
import IssueCombobox from '../../components/IssueCombobox'
import { candidatesFor, isResolved, resolve, type Related } from './issueIndex'
```

(the `issueIndex` import already exists — extend it rather than adding a
second one.)

Take the issue array from the index hook on line 32 and derive the
candidates:

```tsx
  const { index, issues } = useIssueIndex()
  const related = resolve(dependencies, index, 'depends_on_id')
  const active = related.filter(item => !isResolved(item))
  const resolved = related.filter(isResolved)

  // Offering the issue itself, or a blocker it already has, would only earn a
  // rejection from td.
  const candidates = candidatesFor(issues, [issueId, ...dependencies.map(d => d.depends_on_id)])
```

Replace the `<input>` at lines 68–74 with the combobox, wrapped so the flex
row still stretches it:

```tsx
        <div className="flex-1">
          <IssueCombobox
            id="dependency-entry"
            value={entry}
            onChange={setEntry}
            candidates={candidates}
            placeholder="td-…"
            className="w-full rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 font-mono text-ink"
          />
        </div>
```

Leave the `<label htmlFor="dependency-entry" className="sr-only">` line and
the submit button untouched.

- [ ] **Step 4: Run the full panel suite**

Run from `web/`: `npm test -- --run src/features/issues/DependencyPanel.test.tsx`
Expected: PASS, the two new cases and all nine that existed before.

- [ ] **Step 5: Run the detail-view suite, which mounts the panel**

Run from `web/`: `npm test -- --run src/features/issues/IssueDetail.test.tsx`
Expected: PASS, unchanged.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/issues/DependencyPanel.tsx web/src/features/issues/DependencyPanel.test.tsx
git commit -m "feat(web): pick a dependency by title instead of by id"
```

---

### Task 5: The parent field uses it

**Files:**
- Modify: `web/src/features/issues/IssueEditForm.tsx` (lines 166–171)
- Test: `web/src/features/issues/IssueEditForm.test.tsx`

**Interfaces:**
- Consumes: `candidatesFor` (Task 1), `IssueCombobox` (Tasks 2–3),
  `useIssueIndex` from `./useIssueIndex`.
- Produces: nothing new. The input keeps `id="edit-parent"` and its `Parent`
  label, and `FieldError` stays where it is.

- [ ] **Step 1: Write the failing tests**

`IssueEditForm` will fetch the issue list, and this suite runs msw with
`onUnhandledRequest: 'error'`. Add a default handler to the existing
`setupServer(…)` call at line 21, next to the `/v1/labels` one:

```tsx
  http.get('/v1/issues', () => HttpResponse.json({
    ok: true, data: { issues: [], limit: 1000, offset: 0, total: 0, has_more: false },
  })),
```

Then add these cases inside `describe('IssueEditForm', …)`:

```tsx
  it('patches parent_id with the id of a parent picked by title', async () => {
    server.use(http.get('/v1/issues', () => HttpResponse.json({
      ok: true,
      data: {
        issues: [{ ...issue, id: 'td-epic01', title: 'The containing epic', type: 'epic' }],
        limit: 1000, offset: 0, total: 1, has_more: false,
      },
    })))
    let body: unknown
    server.use(http.patch('/v1/issues/td-6a0883', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ ok: true, data: { issue } })
    }))
    renderForm()

    await userEvent.click(screen.getByLabelText('Parent'))
    await userEvent.click(await screen.findByText('The containing epic'))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(body).toEqual({ parent_id: 'td-epic01' }))
  })

  // An issue cannot be its own parent, so it is not on offer.
  it('does not offer the issue itself as its own parent', async () => {
    server.use(http.get('/v1/issues', () => HttpResponse.json({
      ok: true,
      data: {
        issues: [issue, { ...issue, id: 'td-other', title: 'Some other issue' }],
        limit: 1000, offset: 0, total: 2, has_more: false,
      },
    })))
    renderForm()

    await userEvent.click(screen.getByLabelText('Parent'))

    expect(await screen.findByRole('option')).toHaveTextContent('Some other issue')
    expect(screen.getAllByRole('option')).toHaveLength(1)
  })

  it('still clears the parent when the field is emptied', async () => {
    let body: unknown
    server.use(http.patch('/v1/issues/td-6a0883', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ ok: true, data: { issue } })
    }))
    const parented = { ...issue, parent_id: 'td-epic01' }
    const { setEditing } = renderForm()
    // The draft is seeded when the editor opens, not on every re-render, so
    // the issue has to arrive through a close and a re-open to reach the form.
    setEditing(false)
    setEditing(true, parented)

    await userEvent.clear(screen.getByLabelText('Parent'))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(body).toEqual({ parent_id: '' }))
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `web/`: `npm test -- --run src/features/issues/IssueEditForm.test.tsx`
Expected: the first two new cases FAIL — the plain input renders no options.
The third (clearing) passes already; it is a regression guard for this task,
not a new behaviour.

- [ ] **Step 3: Wire the combobox in**

In `web/src/features/issues/IssueEditForm.tsx`, add the imports:

```tsx
import IssueCombobox from '../../components/IssueCombobox'
import { candidatesFor } from './issueIndex'
import { useIssueIndex } from './useIssueIndex'
```

Add the hook next to `const update = useUpdateIssue(issue.id)` on line 51:

```tsx
  // The same query the detail view already has in cache — the parent picker
  // costs no request of its own. The form is mounted while the editor is
  // closed too, which is why this sits with the other unconditional hooks.
  const { issues } = useIssueIndex()
```

Replace the parent `<input>` at lines 168–169 with:

```tsx
              <IssueCombobox id="edit-parent" value={draft.parent_id}
                onChange={next => set('parent_id', next)}
                candidates={candidatesFor(issues, [issue.id])}
                placeholder="td-…" className={fieldClass} />
```

Leave the `<label htmlFor="edit-parent">` and the `<FieldError … field="parent_id" />`
below it untouched — `boundFields` still lists `parent_id`, and that list is
asserted by a test.

- [ ] **Step 4: Run the full form suite**

Run from `web/`: `npm test -- --run src/features/issues/IssueEditForm.test.tsx`
Expected: PASS, the three new cases and every case that existed before.

- [ ] **Step 5: Run the whole check**

Run from the repository root: `make test`
Expected: lint clean, Go tests ok, frontend suite green. Check the output for
`--- SKIP` on `test/contract` — that package skips itself when `td` is not on
PATH, which a green run does not tell you. This change touches no Go code, so
a skip there is expected and harmless.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/issues/IssueEditForm.tsx web/src/features/issues/IssueEditForm.test.tsx
git commit -m "feat(web): pick a parent by title instead of by id"
```

---

## Manual check before review

`make build && ./td-gui` (or `npm run dev` from `web/`), then open any issue's
detail view:

1. Click into "Add dependency" with an empty field — the list opens with the
   project's open issues first, closed ones at the bottom.
2. Type part of a title — the list narrows; ids and titles both match.
3. Arrow down, Enter — the id lands in the field and the form does not save.
4. Enter again — the dependency is added.
5. Open the editor, click into Parent — the issue itself is absent from the
   list.
6. Check both themes: the listbox background is `bg-surface-raised` and the
   active row `bg-surface-hover`, so the toggle flips it with everything else.
