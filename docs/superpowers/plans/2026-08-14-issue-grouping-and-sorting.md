# Issue list grouping and sorting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group the td-gui issue list into status sections with a coloured group header, and let the user sort rows within each group by id, title, priority or last-updated.

**Architecture:** All ordering logic lives in one pure module (`ordering.ts`) with no React in it, so the rules are unit-tested directly. The list fetches the whole result set in one request because `td serve` cannot sort — pagination is removed. Column geometry moves into a single shared module so the header row, the data row and the loading skeleton cannot drift apart.

**Tech Stack:** React 19, TypeScript, Tailwind v4 (`@theme inline` tokens), TanStack Query, Vitest + Testing Library + msw.

Spec: `docs/superpowers/specs/2026-08-14-issue-grouping-and-sorting-design.md`
td issue: `td-43e9ce`
Branch: `feat/issue-grouping` (already created, spec already committed)

## Global Constraints

- **English only.** UI strings, code, comments, commit messages. No i18n layer.
- **Error text from td is displayed verbatim**, never rewritten.
- **The frontend never validates against hardcoded field limits.** `FETCH_LIMIT` is a paging cap, not a validation bound — it is the one number this plan introduces.
- **Transitions go through td's own endpoints.** No task here touches transitions.
- **The Go server is standard-library only.** No task here touches Go.
- Commits follow Conventional Commits with a package scope: `feat(web):`, `refactor(web):`, `test:`, `docs:`.
- Frontend commands run from `web/`. Use `npm test -- --run` (bare `npm test` watches).
- Run `make test` from the repo root before the final commit of the last task; it lints first, so a lint error stops the run.

---

### Task 1: Sorting rules

**Files:**
- Create: `web/src/features/issues/ordering.ts`
- Create: `web/src/features/issues/ordering.test.ts`
- Create: `web/src/features/issues/issue.fixture.ts`
- Test: `web/src/features/issues/ordering.test.ts`

**Interfaces:**
- Consumes: `Issue`, `IssueStatus`, `Priority` from `web/src/api/types.ts`.
- Produces:
  - `type SortKey = 'id' | 'title' | 'priority' | 'updated'`
  - `type SortDirection = 'asc' | 'desc'`
  - `interface Sort { key: SortKey; direction: SortDirection }`
  - `const DEFAULT_SORT: Sort` — `{ key: 'priority', direction: 'asc' }`
  - `function sortIssues(issues: Issue[], sort: Sort): Issue[]` — returns a new array, never mutates.
  - `function makeIssue(over?: Partial<Issue>): Issue` (from `issue.fixture.ts`)

- [ ] **Step 1: Write the issue fixture**

`td`'s `Issue` has 25 fields and every test needs one. This factory is imported
by tests only; nothing in the app imports it, so it is not in the bundle.

Create `web/src/features/issues/issue.fixture.ts`:

```ts
import type { Issue } from '../../api/types'

/** A complete, boring Issue. Tests override only the fields they care about. */
export function makeIssue(over: Partial<Issue> = {}): Issue {
  return {
    id: 'td-000000',
    title: 'An issue',
    description: '',
    status: 'open',
    type: 'feature',
    priority: 'P2',
    points: 0,
    labels: [],
    parent_id: null,
    acceptance: '',
    sprint: '',
    implementer_session: null,
    creator_session: 'ses_d87edf',
    reviewer_session: null,
    review_requested_by_session: null,
    closed_by_session: null,
    created_at: '2026-08-14T15:01:46+02:00',
    updated_at: '2026-08-14T15:01:46+02:00',
    reviewed_at: null,
    closed_at: null,
    deleted_at: null,
    minor: false,
    created_branch: null,
    defer_until: null,
    due_date: null,
    defer_count: 0,
    ...over,
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `web/src/features/issues/ordering.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_SORT, sortIssues } from './ordering'
import { makeIssue } from './issue.fixture'

const ids = (issues: { id: string }[]) => issues.map(i => i.id)

describe('sortIssues', () => {
  it('defaults to priority ascending, which is the order td already returns', () => {
    expect(DEFAULT_SORT).toEqual({ key: 'priority', direction: 'asc' })
  })

  it('orders by priority rank, not alphabetically', () => {
    const issues = [
      makeIssue({ id: 'td-c', priority: 'P2' }),
      makeIssue({ id: 'td-a', priority: 'P0' }),
      makeIssue({ id: 'td-b', priority: 'P1' }),
    ]
    expect(ids(sortIssues(issues, { key: 'priority', direction: 'asc' })))
      .toEqual(['td-a', 'td-b', 'td-c'])
    expect(ids(sortIssues(issues, { key: 'priority', direction: 'desc' })))
      .toEqual(['td-c', 'td-b', 'td-a'])
  })

  it('puts an unrecognised priority last in both directions', () => {
    const issues = [
      makeIssue({ id: 'td-weird', priority: 'P9' as never }),
      makeIssue({ id: 'td-a', priority: 'P0' }),
      makeIssue({ id: 'td-b', priority: 'P3' }),
    ]
    expect(ids(sortIssues(issues, { key: 'priority', direction: 'asc' })))
      .toEqual(['td-a', 'td-b', 'td-weird'])
    expect(ids(sortIssues(issues, { key: 'priority', direction: 'desc' })))
      .toEqual(['td-b', 'td-a', 'td-weird'])
  })

  it('orders by parsed timestamp, so a daylight-saving offset change cannot fool it', () => {
    // Same wall-clock date, different offsets — the hour either side of a DST
    // change. As strings, "02:00:00+01:00" sorts BEFORE "02:30:00+02:00"; as
    // instants it is the other way round, 01:00Z after 00:30Z. A string
    // comparison therefore fails this test, which is the whole point of it.
    const issues = [
      makeIssue({ id: 'td-later', updated_at: '2026-03-29T02:00:00+01:00' }),
      makeIssue({ id: 'td-earlier', updated_at: '2026-03-29T02:30:00+02:00' }),
    ]
    expect(ids(sortIssues(issues, { key: 'updated', direction: 'asc' })))
      .toEqual(['td-earlier', 'td-later'])
  })

  it('puts an unparseable timestamp last in both directions', () => {
    const issues = [
      makeIssue({ id: 'td-broken', updated_at: 'not a date' }),
      makeIssue({ id: 'td-old', updated_at: '2026-01-01T00:00:00+02:00' }),
      makeIssue({ id: 'td-new', updated_at: '2026-08-01T00:00:00+02:00' }),
    ]
    expect(ids(sortIssues(issues, { key: 'updated', direction: 'asc' })))
      .toEqual(['td-old', 'td-new', 'td-broken'])
    expect(ids(sortIssues(issues, { key: 'updated', direction: 'desc' })))
      .toEqual(['td-new', 'td-old', 'td-broken'])
  })

  it('orders by id and by title', () => {
    const issues = [
      makeIssue({ id: 'td-c', title: 'Beta' }),
      makeIssue({ id: 'td-a', title: 'Gamma' }),
      makeIssue({ id: 'td-b', title: 'Alpha' }),
    ]
    expect(ids(sortIssues(issues, { key: 'id', direction: 'asc' })))
      .toEqual(['td-a', 'td-b', 'td-c'])
    expect(ids(sortIssues(issues, { key: 'title', direction: 'asc' })))
      .toEqual(['td-b', 'td-c', 'td-a'])
  })

  it('breaks ties on id, so a refetch cannot reshuffle equal rows', () => {
    const issues = [
      makeIssue({ id: 'td-c', priority: 'P1' }),
      makeIssue({ id: 'td-a', priority: 'P1' }),
      makeIssue({ id: 'td-b', priority: 'P1' }),
    ]
    // The tie-break is NOT reversed by direction: it exists to make the order
    // deterministic, not to be part of the user's chosen ordering.
    expect(ids(sortIssues(issues, { key: 'priority', direction: 'asc' })))
      .toEqual(['td-a', 'td-b', 'td-c'])
    expect(ids(sortIssues(issues, { key: 'priority', direction: 'desc' })))
      .toEqual(['td-a', 'td-b', 'td-c'])
  })

  it('does not mutate its input', () => {
    const issues = [
      makeIssue({ id: 'td-b', priority: 'P3' }),
      makeIssue({ id: 'td-a', priority: 'P0' }),
    ]
    sortIssues(issues, { key: 'priority', direction: 'asc' })
    expect(ids(issues)).toEqual(['td-b', 'td-a'])
  })
})
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run from `web/`: `npm test -- --run ordering`
Expected: FAIL — `Failed to resolve import "./ordering"`.

- [ ] **Step 4: Implement the sorting half of the module**

Create `web/src/features/issues/ordering.ts`:

```ts
import type { Issue, Priority } from '../../api/types'

export type SortKey = 'id' | 'title' | 'priority' | 'updated'
export type SortDirection = 'asc' | 'desc'

export interface Sort {
  key: SortKey
  direction: SortDirection
}

/** Priority ascending is the order td serve already returns, so the first
    render looks the way it did before this feature existed. */
export const DEFAULT_SORT: Sort = { key: 'priority', direction: 'asc' }

const PRIORITY_ORDER: Priority[] = ['P0', 'P1', 'P2', 'P3', 'P4']

/** null means "cannot be ordered on this key" — those rows go last. */
function rank(issue: Issue, key: SortKey): number | null {
  if (key !== 'priority' && key !== 'updated') return 0
  if (key === 'priority') {
    const index = PRIORITY_ORDER.indexOf(issue.priority)
    return index === -1 ? null : index
  }
  const time = new Date(issue.updated_at).getTime()
  return Number.isNaN(time) ? null : time
}

function compare(a: Issue, b: Issue, key: SortKey): number {
  switch (key) {
    case 'id':
      return a.id.localeCompare(b.id)
    case 'title':
      return a.title.localeCompare(b.title)
    default:
      return (rank(a, key) as number) - (rank(b, key) as number)
  }
}

const byId = (a: Issue, b: Issue) => a.id.localeCompare(b.id)

/**
 * Sorts a copy. Rows that cannot be ordered on the chosen key — an
 * unrecognised priority, an unparseable timestamp — are partitioned out and
 * appended, so they stay last whichever direction is chosen instead of
 * flipping to the top. Every comparison falls back to the id, which makes the
 * result a total order: without it an SSE refetch could reshuffle equal rows
 * and the list would twitch under the user.
 */
export function sortIssues(issues: Issue[], sort: Sort): Issue[] {
  const factor = sort.direction === 'asc' ? 1 : -1
  const sortable: Issue[] = []
  const unsortable: Issue[] = []
  for (const issue of issues) {
    if (rank(issue, sort.key) === null) unsortable.push(issue)
    else sortable.push(issue)
  }

  sortable.sort((a, b) => compare(a, b, sort.key) * factor || byId(a, b))
  unsortable.sort(byId)
  return [...sortable, ...unsortable]
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run from `web/`: `npm test -- --run ordering`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/issues/ordering.ts web/src/features/issues/ordering.test.ts web/src/features/issues/issue.fixture.ts
git commit -m "feat(web): add issue sorting rules"
```

---

### Task 2: Grouping by status

**Files:**
- Modify: `web/src/features/issues/ordering.ts`
- Modify: `web/src/features/issues/ordering.test.ts`

**Interfaces:**
- Consumes: `sortIssues`, `Sort`, `makeIssue` from Task 1.
- Produces:
  - `const STATUS_ORDER: IssueStatus[]` — `['in_progress', 'open', 'in_review', 'blocked', 'closed']`
  - `interface IssueGroup { status: string; issues: Issue[] }` — `status` is a plain string, not `IssueStatus`, because an unknown status must survive.
  - `function groupByStatus(issues: Issue[], sort: Sort): IssueGroup[]`

- [ ] **Step 1: Write the failing tests**

Append to `web/src/features/issues/ordering.test.ts` (and extend the import at
the top to `import { DEFAULT_SORT, groupByStatus, sortIssues, STATUS_ORDER } from './ordering'`):

```ts
describe('groupByStatus', () => {
  it('returns groups in attention order, not input order', () => {
    const groups = groupByStatus([
      makeIssue({ id: 'td-closed', status: 'closed' }),
      makeIssue({ id: 'td-open', status: 'open' }),
      makeIssue({ id: 'td-prog', status: 'in_progress' }),
    ], DEFAULT_SORT)
    expect(groups.map(g => g.status)).toEqual(['in_progress', 'open', 'closed'])
  })

  it('omits statuses with no issues', () => {
    const groups = groupByStatus([makeIssue({ status: 'open' })], DEFAULT_SORT)
    expect(groups.map(g => g.status)).toEqual(['open'])
    expect(STATUS_ORDER).toContain('blocked')
  })

  it('keeps an unknown status as its own trailing group instead of dropping it', () => {
    const groups = groupByStatus([
      makeIssue({ id: 'td-new', status: 'archived' as never }),
      makeIssue({ id: 'td-open', status: 'open' }),
    ], DEFAULT_SORT)
    expect(groups.map(g => g.status)).toEqual(['open', 'archived'])
    expect(groups[1].issues.map(i => i.id)).toEqual(['td-new'])
  })

  it('orders several unknown statuses by first appearance', () => {
    const groups = groupByStatus([
      makeIssue({ id: 'td-2', status: 'zeta' as never }),
      makeIssue({ id: 'td-1', status: 'alpha' as never }),
    ], DEFAULT_SORT)
    expect(groups.map(g => g.status)).toEqual(['zeta', 'alpha'])
  })

  it('sorts within each group and never moves an issue between groups', () => {
    // The ids deliberately disagree with the priority order: by id the open
    // group reads td-aaa, td-zzz; by priority it reads td-zzz, td-aaa. With
    // ids that agreed, an implementation ignoring the sort key entirely would
    // pass this test.
    const issues = [
      makeIssue({ id: 'td-aaa', status: 'open', priority: 'P3' }),
      makeIssue({ id: 'td-mmm', status: 'in_progress', priority: 'P2' }),
      makeIssue({ id: 'td-zzz', status: 'open', priority: 'P0' }),
    ]

    const asc = groupByStatus(issues, { key: 'priority', direction: 'asc' })
    expect(asc.map(g => g.status)).toEqual(['in_progress', 'open'])
    // td-zzz is P0, the highest priority in the whole list, and still sits
    // below the in_progress group: the grouping outranks the sort.
    expect(asc[0].issues.map(i => i.id)).toEqual(['td-mmm'])
    expect(asc[1].issues.map(i => i.id)).toEqual(['td-zzz', 'td-aaa'])

    // Reversing the direction reorders inside the group but must not reorder
    // the groups themselves.
    const desc = groupByStatus(issues, { key: 'priority', direction: 'desc' })
    expect(desc.map(g => g.status)).toEqual(['in_progress', 'open'])
    expect(desc[1].issues.map(i => i.id)).toEqual(['td-aaa', 'td-zzz'])
  })

  it('returns no groups for no issues', () => {
    expect(groupByStatus([], DEFAULT_SORT)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run from `web/`: `npm test -- --run ordering`
Expected: FAIL — `groupByStatus is not a function` (or an unresolved export).

- [ ] **Step 3: Implement grouping**

Add to `web/src/features/issues/ordering.ts` — extend the type import to
`import type { Issue, IssueStatus, Priority } from '../../api/types'`:

```ts
/** Attention order, not alphabetical: what is moving comes before what is not. */
export const STATUS_ORDER: IssueStatus[] = [
  'in_progress', 'open', 'in_review', 'blocked', 'closed',
]

export interface IssueGroup {
  /** A plain string, not IssueStatus: a status td adds later must still render. */
  status: string
  issues: Issue[]
}

/**
 * Buckets issues by status and sorts within each bucket. Empty statuses are
 * omitted — an empty `blocked` section is noise. A status we do not recognise
 * gets its own group after the known ones, in first-seen order: an issue must
 * never disappear from the list because td grew a status we have not heard of.
 */
export function groupByStatus(issues: Issue[], sort: Sort): IssueGroup[] {
  const buckets = new Map<string, Issue[]>()
  for (const issue of issues) {
    const bucket = buckets.get(issue.status)
    if (bucket) bucket.push(issue)
    else buckets.set(issue.status, [issue])
  }

  const known = STATUS_ORDER.filter(status => buckets.has(status))
  // Map iteration is insertion-ordered, which is what gives "first seen".
  const unknown = [...buckets.keys()].filter(
    status => !STATUS_ORDER.includes(status as IssueStatus),
  )

  return [...known, ...unknown].map(status => ({
    status,
    issues: sortIssues(buckets.get(status)!, sort),
  }))
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run from `web/`: `npm test -- --run ordering`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/issues/ordering.ts web/src/features/issues/ordering.test.ts
git commit -m "feat(web): group issues by status with a fixed group order"
```

---

### Task 3: One shared source for the column geometry

Pure refactor. No behaviour changes, no new tests — the existing suite is the
check. Do this **before** adding a third consumer of these classes.

**Files:**
- Create: `web/src/features/issues/columns.ts`
- Modify: `web/src/features/issues/IssueList.tsx` (the row `<Link>`, currently lines 97–107)
- Modify: `web/src/components/SkeletonRows.tsx`

**Interfaces:**
- Produces: `ROW_LAYOUT`, `ROW`, `COL` from `web/src/features/issues/columns.ts`.

- [ ] **Step 1: Create the module**

Create `web/src/features/issues/columns.ts`:

```ts
/**
 * The issue list's column geometry, in one place.
 *
 * Three components lay out the same columns: the data row (IssueList), the
 * loading skeleton (SkeletonRows) and the sortable header (IssueListHeader).
 * When the widths were duplicated the row and the skeleton drifted apart by a
 * pixel (fixed in 4ce3b18) — with a third copy that is a matter of time.
 *
 * ROW keeps h-row, the border and the padding on ONE element, because under
 * box-sizing: border-box an explicit height on that element fixes the rendered
 * total regardless of the padding. Splitting them across two boxes is what
 * caused the drift.
 */
export const ROW_LAYOUT = 'flex items-center gap-3 px-4'

export const ROW = `${ROW_LAYOUT} h-row border-b border-line-subtle py-2`

export const COL = {
  id: 'w-[74px] shrink-0',
  title: 'flex-1 truncate',
  // w-7, not the skeleton's old w-5: the real row never constrained the
  // priority tag before, and "P0" in semibold mono needs the headroom.
  priority: 'w-7 shrink-0',
  updated: 'w-[64px] shrink-0 text-right',
  status: 'w-[74px] shrink-0 text-right',
} as const
```

- [ ] **Step 2: Use it in the data row**

In `web/src/features/issues/IssueList.tsx`, add the import:

```tsx
import { COL, ROW } from './columns'
```

Replace the row `<Link>` block (the comment above it about h-row now lives in
`columns.ts`, so drop it here) with:

```tsx
<Link
  to={`/issues/${issue.id}`}
  className={`${ROW} hover:bg-surface-hover hover:shadow-[inset_2px_0_0_var(--color-accent)]`}
>
  <span className={`${COL.id} font-mono text-ink-faint`}>{issue.id}</span>
  <span className={`${COL.title} text-ink`}>{issue.title}</span>
  <span className={COL.priority}><PriorityTag priority={issue.priority} /></span>
  <span className={COL.status}><StatusTag status={issue.status} /></span>
</Link>
```

Note: `COL.updated` is defined but not used yet — Task 7 adds that cell.

- [ ] **Step 3: Use it in the skeleton**

Replace `web/src/components/SkeletonRows.tsx` with:

```tsx
import { COL, ROW } from '../features/issues/columns'

/**
 * Placeholder rows at the real row height, so nothing jumps when data lands.
 *
 * Geometry comes from the shared columns module, so this cannot drift from the
 * real row. The bars carry no text, so a bare flex row would size to its
 * tallest child (~11px) — the height in ROW is what prevents that.
 */
export default function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading issues">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden="true" className={ROW}>
          <span className={`${COL.id} h-[11px] rounded-sm bg-surface-hover`} />
          <span className={`${COL.title} h-[11px] rounded-sm bg-surface-hover`} />
          <span className={`${COL.priority} h-[11px] rounded-sm bg-surface-hover`} />
          <span className={`${COL.status} h-[11px] rounded-sm bg-surface-hover`} />
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run the whole frontend suite**

Run from `web/`: `npm test -- --run`
Expected: PASS, 65 tests — 51 before this plan, plus the 14 from Tasks 1 and 2.
This task changes no behaviour, so the count must not move.

- [ ] **Step 5: Check it by eye**

`COL.title` adds `truncate` to the skeleton's title bar, which is inert on an
empty span, and `COL.priority` changes the priority bar from `w-5` to `w-7`
while newly constraining the real row's priority cell, which was unconstrained
before. Confirm the skeleton still lines up with the real rows: from the repo root run
`make build && ./td-gui -no-open -port 7788`, open `http://127.0.0.1:7788`, and
watch the first paint. Stop the server afterwards.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/issues/columns.ts web/src/features/issues/IssueList.tsx web/src/components/SkeletonRows.tsx
git commit -m "refactor(web): give the issue row, skeleton and header one column source"
```

---

### Task 4: The group header

**Files:**
- Create: `web/src/features/issues/IssueGroupHeader.tsx`
- Create: `web/src/features/issues/IssueGroupHeader.test.tsx`

**Interfaces:**
- Consumes: `StatusTag` from `web/src/components/StatusTag.tsx`.
- Produces: `default function IssueGroupHeader({ status, count }: { status: string; count: number })`

- [ ] **Step 1: Write the failing test**

Create `web/src/features/issues/IssueGroupHeader.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import IssueGroupHeader from './IssueGroupHeader'

describe('IssueGroupHeader', () => {
  it('names the status and states how many issues are in it', () => {
    render(<IssueGroupHeader status="in_progress" count={3} />)
    expect(screen.getByText('in_progress')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders an unknown status verbatim rather than hiding the group', () => {
    render(<IssueGroupHeader status="archived" count={1} />)
    expect(screen.getByText('archived')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run from `web/`: `npm test -- --run IssueGroupHeader`
Expected: FAIL — `Failed to resolve import "./IssueGroupHeader"`.

- [ ] **Step 3: Implement the component**

Create `web/src/features/issues/IssueGroupHeader.tsx`:

```tsx
import StatusTag from '../../components/StatusTag'

/* Background twins of StatusTag's text colours. Tailwind needs the class names
   to appear literally, so this cannot be built by interpolation. */
const statusBar: Record<string, string> = {
  open: 'bg-st-open',
  in_progress: 'bg-st-progress',
  in_review: 'bg-st-review',
  blocked: 'bg-st-blocked',
  closed: 'bg-st-closed',
}

/**
 * Opens a status section. The colour never carries the meaning on its own —
 * the status name sits right next to the bar — so the grouping survives
 * without colour perception.
 */
export default function IssueGroupHeader({
  status,
  count,
}: {
  status: string
  count: number
}) {
  return (
    <div className="flex items-center gap-3 border-y border-line bg-surface-inset px-4 py-1.5">
      <span
        aria-hidden="true"
        className={`h-3.5 w-0.5 rounded-full ${statusBar[status] ?? 'bg-line'}`}
      />
      <StatusTag status={status} />
      <span className="flex-1" />
      <span className="font-mono text-[11px] text-ink-faint">{count}</span>
    </div>
  )
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run from `web/`: `npm test -- --run IssueGroupHeader`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/issues/IssueGroupHeader.tsx web/src/features/issues/IssueGroupHeader.test.tsx
git commit -m "feat(web): add the status group header"
```

---

### Task 5: The sortable column header

**Files:**
- Create: `web/src/features/issues/IssueListHeader.tsx`
- Create: `web/src/features/issues/IssueListHeader.test.tsx`

**Interfaces:**
- Consumes: `Sort`, `SortKey`, `DEFAULT_SORT` from `./ordering`; `COL`, `ROW_LAYOUT` from `./columns`.
- Produces: `default function IssueListHeader({ sort, onChange }: { sort: Sort; onChange: (sort: Sort) => void })`

**Accessible names** — later tasks query by these exact strings:
- inactive column: `Sort by title, ascending`
- active, currently ascending: `Sorted by priority, ascending. Sort descending.`
- active, currently descending: `Sorted by priority, descending. Sort ascending.`

There is deliberately **no `aria-sort`**: the list is a `<ul>`, not a table or
grid, and `aria-sort` is only meaningful on table headers. Faking table
semantics to borrow the attribute would be worse than saying it plainly.

- [ ] **Step 1: Write the failing test**

Create `web/src/features/issues/IssueListHeader.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IssueListHeader from './IssueListHeader'
import { DEFAULT_SORT } from './ordering'

describe('IssueListHeader', () => {
  it('states the current sort and what a click would do', () => {
    render(<IssueListHeader sort={DEFAULT_SORT} onChange={vi.fn()} />)
    expect(screen.getByRole('button', {
      name: 'Sorted by priority, ascending. Sort descending.',
    })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sort by title, ascending' }))
      .toBeInTheDocument()
  })

  it('flips the direction when the active column is clicked again', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<IssueListHeader sort={DEFAULT_SORT} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: /^Sorted by priority/ }))
    expect(onChange).toHaveBeenCalledWith({ key: 'priority', direction: 'desc' })
  })

  it('starts a new column ascending rather than inheriting the direction', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <IssueListHeader
        sort={{ key: 'priority', direction: 'desc' }}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Sort by updated, ascending' }))
    expect(onChange).toHaveBeenCalledWith({ key: 'updated', direction: 'asc' })
  })

  it('offers no sort control for status, which is the grouping', () => {
    render(<IssueListHeader sort={DEFAULT_SORT} onChange={vi.fn()} />)
    expect(screen.getByText('STATUS')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /status/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run from `web/`: `npm test -- --run IssueListHeader`
Expected: FAIL — `Failed to resolve import "./IssueListHeader"`.

- [ ] **Step 3: Implement the component**

Create `web/src/features/issues/IssueListHeader.tsx`:

```tsx
import { COL, ROW_LAYOUT } from './columns'
import type { Sort, SortKey } from './ordering'

const LABEL: Record<SortKey, string> = {
  id: 'ID',
  title: 'TITLE',
  priority: 'PRIO',
  updated: 'UPDATED',
}

interface SortButtonProps {
  column: SortKey
  sort: Sort
  onChange: (sort: Sort) => void
}

function SortButton({ column, sort, onChange }: SortButtonProps) {
  const active = sort.key === column
  const flipped: Sort['direction'] = sort.direction === 'asc' ? 'desc' : 'asc'
  const next: Sort = active
    ? { key: column, direction: flipped }
    : { key: column, direction: 'asc' }

  // The name says both where the list stands and what the click will do; the
  // arrow alone is not available to a screen reader.
  const name = active
    ? `Sorted by ${column}, ${sort.direction === 'asc' ? 'ascending' : 'descending'}. Sort ${flipped === 'asc' ? 'ascending' : 'descending'}.`
    : `Sort by ${column}, ascending`

  return (
    <button
      type="button"
      aria-label={name}
      onClick={() => onChange(next)}
      className={active ? 'text-ink' : 'text-ink-faint hover:text-ink-muted'}
    >
      {LABEL[column]}
      <span aria-hidden="true">{active ? (sort.direction === 'asc' ? ' ▴' : ' ▾') : ''}</span>
    </button>
  )
}

/** STATUS has no button: it is the grouping, so sorting by it is a no-op. */
export default function IssueListHeader({
  sort,
  onChange,
}: {
  sort: Sort
  onChange: (sort: Sort) => void
}) {
  return (
    <div
      className={`${ROW_LAYOUT} border-b border-line py-1.5 text-[11px] tracking-wider text-ink-faint`}
    >
      <span className={COL.id}><SortButton column="id" sort={sort} onChange={onChange} /></span>
      <span className={COL.title}><SortButton column="title" sort={sort} onChange={onChange} /></span>
      <span className={COL.priority}><SortButton column="priority" sort={sort} onChange={onChange} /></span>
      <span className={COL.updated}><SortButton column="updated" sort={sort} onChange={onChange} /></span>
      <span className={COL.status}>STATUS</span>
    </div>
  )
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run from `web/`: `npm test -- --run IssueListHeader`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/issues/IssueListHeader.tsx web/src/features/issues/IssueListHeader.test.tsx
git commit -m "feat(web): add the sortable issue list column header"
```

---

### Task 6: Fetch the whole list, drop pagination

**Files:**
- Modify: `web/src/api/queries.ts` (`IssueListParams`, `toQueryString`)
- Modify: `web/src/features/issues/IssueList.tsx` (remove `Pagination`, lines 13–50 and its uses)
- Modify: `web/src/features/issues/IssueList.test.tsx`

**Interfaces:**
- Produces: `IssueListParams` without `offset`; `FETCH_LIMIT = 500` exported from `IssueList.tsx` is **not** needed elsewhere — keep it module-private.

- [ ] **Step 1: Write the failing tests**

In `web/src/features/issues/IssueList.test.tsx`: delete the test
`keeps prev reachable when a stale offset lands on an empty page` entirely —
the behaviour it guards cannot occur once every request starts at offset 0.

Replace the inline `issue` constant with the shared fixture. At the top:

```tsx
import { makeIssue } from './issue.fixture'
```

and delete the local `const issue = { … }` block, replacing its uses with
`makeIssue({ id: 'td-6a0883', title: 'Probe issue for API shape' })`.

Then add:

```tsx
it('asks for the whole list in one request, with no offset', async () => {
  let seen: URL | undefined
  server.use(http.get('/v1/issues', ({ request }) => {
    seen = new URL(request.url)
    return HttpResponse.json({
      ok: true,
      data: { issues: [], limit: 500, offset: 0, total: 0, has_more: false },
    })
  }))

  renderList()
  await screen.findByText(/no issues/i)
  expect(seen?.searchParams.get('limit')).toBe('500')
  expect(seen?.searchParams.has('offset')).toBe(false)
})

it('says so when the result set is capped, instead of showing a partial picture quietly', async () => {
  server.use(http.get('/v1/issues', () =>
    HttpResponse.json({
      ok: true,
      data: {
        issues: [makeIssue({ id: 'td-1' })],
        limit: 500, offset: 0, total: 812, has_more: true,
      },
    })))

  renderList()
  expect(await screen.findByText(/Showing 1 of 812/)).toBeInTheDocument()
})

it('stays quiet when the whole list fits', async () => {
  server.use(http.get('/v1/issues', () =>
    HttpResponse.json({
      ok: true,
      data: {
        issues: [makeIssue({ id: 'td-1' })],
        limit: 500, offset: 0, total: 1, has_more: false,
      },
    })))

  renderList()
  await screen.findByText('td-1')
  expect(screen.queryByText(/Showing/)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run from `web/`: `npm test -- --run IssueList`
Expected: FAIL — the request still carries `offset=0`, and no "Showing" text exists.

- [ ] **Step 3: Drop `offset` from the query layer**

In `web/src/api/queries.ts`, change the interface and the serialiser:

```ts
export interface IssueListParams {
  status?: IssueStatus[]
  type?: IssueType[]
  priority?: Priority[]
  search?: string
  limit: number
}
```

and in `toQueryString`, delete the line `q.set('offset', String(params.offset))`.

- [ ] **Step 4: Rewrite the list's data handling**

In `web/src/features/issues/IssueList.tsx`:

Delete the `PaginationProps` interface and the whole `Pagination` function
(lines 13–50 in the pre-task file), and the now-unused `IssueListResponse`
import.

Replace `const PAGE_SIZE = 50` with:

```tsx
/* td serve cannot sort, so sorting has to happen here — which is only honest
   if we hold the whole result set. One request against a local database is
   cheaper than the round trips it replaces. */
const FETCH_LIMIT = 500
```

Replace the state and handlers:

```tsx
const [params, setParams] = useState<IssueListParams>({ limit: FETCH_LIMIT })
const { data, error, isPending } = useIssues(params)
```

(delete `goPrev` and `goNext`.)

Replace the empty branch with:

```tsx
} else if (data.issues.length === 0) {
  body = (
    <EmptyState
      message="No issues found."
      hint="Try clearing the status filters, or create the first issue."
    />
  )
} else {
  body = (
    <>
      {data.total > data.issues.length && (
        <p className="border-b border-line bg-surface-inset px-4 py-1.5 text-[11px] text-ink-muted">
          Showing {data.issues.length} of {data.total} — refine the filters to
          narrow this down.
        </p>
      )}
      <ul>
        {/* rows unchanged for now; Task 7 replaces this block */}
        {data.issues.map(issue => (
          <li key={issue.id}>
            <Link
              to={`/issues/${issue.id}`}
              className={`${ROW} hover:bg-surface-hover hover:shadow-[inset_2px_0_0_var(--color-accent)]`}
            >
              <span className={`${COL.id} font-mono text-ink-faint`}>{issue.id}</span>
              <span className={`${COL.title} text-ink`}>{issue.title}</span>
              <span className={COL.priority}><PriorityTag priority={issue.priority} /></span>
              <span className={COL.status}><StatusTag status={issue.status} /></span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
```

The filter handler drops its offset reset:

```tsx
<IssueFilters params={params} onChange={setParams} />
```

- [ ] **Step 5: Run the suite and confirm it passes**

Run from `web/`: `npm test -- --run`
Expected: PASS, 73 tests — 71 after Task 5, minus the removed pagination test,
plus the three added here.

- [ ] **Step 6: Commit**

```bash
git add web/src/api/queries.ts web/src/features/issues/IssueList.tsx web/src/features/issues/IssueList.test.tsx
git commit -m "feat(web): fetch the whole issue list instead of paginating"
```

---

### Task 7: Render the groups, wire up sorting

**Files:**
- Modify: `web/src/features/issues/IssueList.tsx`
- Modify: `web/src/features/issues/IssueList.test.tsx`
- Modify: `web/src/components/SkeletonRows.tsx` (add the `updated` bar)

**Interfaces:**
- Consumes: `groupByStatus`, `DEFAULT_SORT`, `Sort` from `./ordering`; `IssueGroupHeader`; `IssueListHeader`; `COL`, `ROW` from `./columns`; `relativeTime` from `web/src/lib/format.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `web/src/features/issues/IssueList.test.tsx`:

```tsx
// Priority order and title order deliberately DISAGREE inside the `open`
// group: td-open-a is the higher priority but sorts last by title. If they
// agreed, the sort-by-title test below would pass without the click doing
// anything at all.
const mixed = [
  makeIssue({ id: 'td-open-a', status: 'open', priority: 'P0', title: 'Zebra' }),
  makeIssue({ id: 'td-prog', status: 'in_progress', priority: 'P2', title: 'Middle' }),
  makeIssue({ id: 'td-open-b', status: 'open', priority: 'P3', title: 'Alpha' }),
]

function serveMixed() {
  server.use(http.get('/v1/issues', () =>
    HttpResponse.json({
      ok: true,
      data: { issues: mixed, limit: 500, offset: 0, total: 3, has_more: false },
    })))
}

/** Row ids in rendered order — the check that grouping actually reordered. */
function renderedIds() {
  return screen.getAllByText(/^td-/).map(el => el.textContent)
}

it('splits the list into status groups with counts', async () => {
  serveMixed()
  renderList()
  expect(await screen.findByText('in_progress')).toBeInTheDocument()
  expect(screen.getByText('open')).toBeInTheDocument()
  // in_progress comes first even though td-open-a (P0) outranks td-prog (P2):
  // the group order wins over the sort.
  expect(renderedIds()).toEqual(['td-prog', 'td-open-a', 'td-open-b'])
})

it('sorts within a group and never moves a row across a group boundary', async () => {
  const user = userEvent.setup()
  serveMixed()
  renderList()
  await screen.findByText('in_progress')

  await user.click(screen.getByRole('button', { name: 'Sort by title, ascending' }))

  // Alpha < Zebra flips the open group; td-prog stays alone on top.
  expect(renderedIds()).toEqual(['td-prog', 'td-open-b', 'td-open-a'])

  await user.click(screen.getByRole('button', { name: /^Sorted by title/ }))
  expect(renderedIds()).toEqual(['td-prog', 'td-open-a', 'td-open-b'])
})

it('shows when each issue was last updated', async () => {
  server.use(http.get('/v1/issues', () =>
    HttpResponse.json({
      ok: true,
      data: {
        issues: [makeIssue({ id: 'td-1', updated_at: new Date().toISOString() })],
        limit: 500, offset: 0, total: 1, has_more: false,
      },
    })))

  renderList()
  expect(await screen.findByText('just now')).toBeInTheDocument()
})
```

Add `import userEvent from '@testing-library/user-event'` at the top of the file.

- [ ] **Step 2: Run the tests and confirm they fail**

Run from `web/`: `npm test -- --run IssueList`
Expected: FAIL — no group headers, no sort buttons, no relative time.

- [ ] **Step 3: Render groups and hold the sort state**

In `web/src/features/issues/IssueList.tsx`, add the imports:

```tsx
import IssueGroupHeader from './IssueGroupHeader'
import IssueListHeader from './IssueListHeader'
import { DEFAULT_SORT, groupByStatus, type Sort } from './ordering'
import { relativeTime } from '../../lib/format'
```

Add the sort state next to `params`:

```tsx
const [sort, setSort] = useState<Sort>(DEFAULT_SORT)
```

Replace the populated branch's `<ul>` block with the grouped render:

```tsx
} else {
  const groups = groupByStatus(data.issues, sort)
  body = (
    <>
      {data.total > data.issues.length && (
        <p className="border-b border-line bg-surface-inset px-4 py-1.5 text-[11px] text-ink-muted">
          Showing {data.issues.length} of {data.total} — refine the filters to
          narrow this down.
        </p>
      )}
      <IssueListHeader sort={sort} onChange={setSort} />
      {groups.map(group => (
        <section key={group.status} aria-label={group.status}>
          <IssueGroupHeader status={group.status} count={group.issues.length} />
          <ul>
            {group.issues.map(issue => (
              <li key={issue.id}>
                <Link
                  to={`/issues/${issue.id}`}
                  className={`${ROW} hover:bg-surface-hover hover:shadow-[inset_2px_0_0_var(--color-accent)]`}
                >
                  <span className={`${COL.id} font-mono text-ink-faint`}>{issue.id}</span>
                  <span className={`${COL.title} text-ink`}>{issue.title}</span>
                  <span className={COL.priority}><PriorityTag priority={issue.priority} /></span>
                  <span className={`${COL.updated} text-ink-faint`}>
                    {relativeTime(issue.updated_at)}
                  </span>
                  <span className={COL.status}><StatusTag status={issue.status} /></span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}
```

- [ ] **Step 4: Add the skeleton's fifth bar**

In `web/src/components/SkeletonRows.tsx`, add between the priority and status
bars:

```tsx
<span className={`${COL.updated} h-[11px] rounded-sm bg-surface-hover`} />
```

- [ ] **Step 5: Run the whole suite**

Run from `web/`: `npm test -- --run`
Expected: PASS, 76 tests.

- [ ] **Step 6: Run lint, typecheck and the full suite**

From the repo root: `make test`
Then from `web/`: `npx tsc -b --noEmit`
Expected: both clean. `make test` lints first, so a lint error stops it before
any test runs.

- [ ] **Step 7: Check it in the running app**

From the repo root: `make build`, then run td-gui against a scratch project
with issues in several statuses (do not point it at a project whose `td serve`
is already running — it will refuse). Confirm by eye:

- group headers with the right colour bar and counts,
- clicking each column header reorders rows inside groups only,
- the row still lines up with the skeleton on first paint,
- both themes, using the header toggle.

Stop the server afterwards.

- [ ] **Step 8: Commit**

```bash
git add web/src/features/issues/IssueList.tsx web/src/features/issues/IssueList.test.tsx web/src/components/SkeletonRows.tsx
git commit -m "feat(web): group the issue list by status and sort within groups"
```

---

### Task 8: Record the outcome

**Files:**
- Modify: `docs/superpowers/specs/2026-08-14-issue-grouping-and-sorting-design.md`

- [ ] **Step 1: Mark the spec implemented**

Change the header line `Status: approved, not yet implemented.` to
`Status: implemented.` and, if the implementation diverged from the spec in any
way, add a short note saying how and why — the way the visual design spec
records its own supersession.

- [ ] **Step 2: Update td**

Log any decision taken during implementation that the spec does not already
record — a decision is worth logging when a future session would otherwise
have to re-derive *why*, not merely *what*. Then hand off and submit:

```bash
td handoff td-43e9ce \
  --done "Status grouping, group-aware sorting by id/title/priority/updated, shared column module, pagination removed" \
  --remaining "Nothing outstanding for this issue" \
  --uncertain "FETCH_LIMIT is 500; unverified against a project large enough to hit it"
td review td-43e9ce
```

Do not run `td approve` — the session that implemented the work cannot
approve it.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-14-issue-grouping-and-sorting-design.md
git commit -m "docs: mark the grouping and sorting spec implemented"
```

---

## Notes for the implementer

- **`npm test` without `--run` watches** in an interactive terminal. Always
  pass `--run`.
- **A green `make test` can mislead.** `test/contract` skips itself when `td`
  is not on PATH and the package still prints `ok`. Check for `--- SKIP`.
- **`make web` must keep `internal/web/dist/.gitkeep`.** The Makefile restores
  it; do not remove that step.
- **Do not open `.todos/issues.db`** and do not run `td init` from the app.
- The `hero.png`, `react.svg` and `vite.svg` assets in `web/src/assets` are
  unrelated to this work.
