# Boards View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give td-gui the boards td already has — a board list, a backlog view whose drag and drop writes td's positions, and a swimlane view whose cross-column drop opens td's own transitions.

**Architecture:** Frontend only. Every board endpoint already exists in `td serve` and `internal/proxy` forwards all paths with the bearer token attached, so no Go code changes except one contract test. New code lives in `web/src/features/boards/`, with types, queries and mutations joining the existing `web/src/api/` modules. `useLiveUpdates` already invalidates the whole query cache on td's SSE `refresh`, so no new freshness plumbing.

**Tech Stack:** React 19, react-router 8, @tanstack/react-query 5, Tailwind 4, Vitest + Testing Library + MSW. Native HTML5 drag and drop — no new dependency.

**Spec:** `docs/superpowers/specs/2026-08-16-boards-view-design.md`

## Global Constraints

- **English only.** UI strings, code, comments, commit messages. No i18n layer.
- **Error text from td is displayed verbatim**, never reworded or translated.
- **No new runtime dependency.** `web/package.json` has exactly four: react, react-dom, react-router, @tanstack/react-query.
- **No hardcoded field limits in the frontend.** td validates; the form shows td's answer bound to the field.
- **Transitions go through td's endpoints**, never a raw status PATCH, and the UI renders exactly the transitions td reports in `available_transitions` — none when the field is absent.
- **The request `position` is td's 1-based insert slot among already-positioned cards.** The `position` in a response is a sparse sort key (1000, 2000, 1500). Never render it, never send it back.
- Commits use Conventional Commits with a package scope: `feat(web):`, `test:`, `docs:`.
- Frontend tests run non-interactively: `npm test -- --run <file>` from `web/`.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `web/src/api/boards.ts` | `boardKeys`, `useBoards`, `useBoard` |
| `web/src/features/boards/position.ts` | `insertSlot` — the only arithmetic in the feature |
| `web/src/features/boards/viewMode.ts` | per-board view preference in `localStorage` |
| `web/src/features/boards/BoardList.tsx` | `/boards` |
| `web/src/features/boards/BoardForm.tsx` | `/boards/new` and `/boards/:id/edit` |
| `web/src/features/boards/BoardCard.tsx` | one card, shared by both views |
| `web/src/features/boards/BoardView.tsx` | `/boards/:id` — loads, toggles view, owns empty states |
| `web/src/features/boards/BacklogView.tsx` | pinned/auto split, reordering, drag and drop |
| `web/src/features/boards/SwimlaneView.tsx` | status columns, cross-column drop |
| `web/src/features/boards/BoardTransitionPanel.tsx` | fetches the issue, renders `TransitionBar` |
| `web/src/features/boards/board.fixture.ts` | `makeBoard`, `makeCard` |

**Modified**

| File | Change |
|---|---|
| `web/src/api/types.ts` | `Board`, `BoardCard`, `BlockerRef`, `DependencySummary`, responses; `dependency_summary?` on `Issue` |
| `web/src/api/mutations.ts` | five board mutations |
| `web/src/App.tsx` | four routes |
| `web/src/components/AppShell.tsx` | `Boards` header link |
| `test/contract/contract_test.go` | `TestBoardPositionSlotContract` |

---

### Task 1: Board types, queries and mutations

**Files:**
- Modify: `web/src/api/types.ts`
- Create: `web/src/api/boards.ts`
- Modify: `web/src/api/mutations.ts`
- Test: `web/src/api/boards.test.tsx`

**Interfaces:**
- Consumes: `apiGet`, `apiSend` from `./client`; `Issue` from `./types`.
- Produces: `Board`, `BoardViewMode`, `BoardCard`, `BlockerRef`, `DependencySummary`, `BoardListResponse`, `BoardResponse`, `BoardCreateResponse` (types); `boardKeys`, `useBoards()`, `useBoard(id, includeClosed?)`; `BoardInput`, `useCreateBoard()`, `useUpdateBoard(id)`, `useDeleteBoard()`, `useSetCardPosition(boardId)`, `useClearCardPosition(boardId)`.

- [ ] **Step 1: Write the failing test**

Create `web/src/api/boards.test.tsx`:

```tsx
import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { useBoard, useBoards } from './boards'
import { useSetCardPosition, useClearCardPosition, useCreateBoard } from './mutations'

const requests: string[] = []
const bodies: unknown[] = []

const server = setupServer(
  http.get('/v1/boards', ({ request }) => {
    requests.push(new URL(request.url).pathname)
    return HttpResponse.json({ ok: true, data: { boards: [] } })
  }),
  http.get('/v1/boards/:id', ({ request }) => {
    const url = new URL(request.url)
    requests.push(url.pathname + url.search)
    return HttpResponse.json({
      ok: true,
      data: { board: null, issues: [] },
    })
  }),
  http.post('/v1/boards', async ({ request }) => {
    bodies.push(await request.json())
    return HttpResponse.json({ ok: true, data: { board: { id: 'bd-new' } } }, { status: 201 })
  }),
  http.post('/v1/boards/:id/issues', async ({ request }) => {
    bodies.push(await request.json())
    return HttpResponse.json({ ok: true, data: { positioned: true } })
  }),
  http.delete('/v1/boards/:id/issues/:issueId', ({ request }) => {
    requests.push(new URL(request.url).pathname)
    return HttpResponse.json({ ok: true, data: { deleted: true } })
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  requests.length = 0
  bodies.length = 0
})
afterAll(() => server.close())

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('board queries', () => {
  it('lists boards', async () => {
    const { result } = renderHook(() => useBoards(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(requests).toContain('/v1/boards')
  })

  it('asks for closed issues only when told to', async () => {
    const plain = renderHook(() => useBoard('bd-1'), { wrapper })
    await waitFor(() => expect(plain.result.current.isSuccess).toBe(true))
    expect(requests).toContain('/v1/boards/bd-1')

    const withClosed = renderHook(() => useBoard('bd-1', true), { wrapper })
    await waitFor(() => expect(withClosed.result.current.isSuccess).toBe(true))
    expect(requests).toContain('/v1/boards/bd-1?include_closed=true')
  })
})

describe('board mutations', () => {
  it('sends name and query when creating a board', async () => {
    const { result } = renderHook(() => useCreateBoard(), { wrapper })
    result.current.mutate({ name: 'Sprint 1', query: 'priority <= P1' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(bodies[0]).toEqual({ name: 'Sprint 1', query: 'priority <= P1' })
  })

  // The slot is td's 1-based insert position, not the sort key read back from
  // the board. Sending the sort key would silently reorder the whole board.
  it('sends the issue id and the slot when positioning a card', async () => {
    const { result } = renderHook(() => useSetCardPosition('bd-1'), { wrapper })
    result.current.mutate({ issueId: 'td-a1b2', slot: 3 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(bodies[0]).toEqual({ issue_id: 'td-a1b2', position: 3 })
  })

  it('clears a position by issue id', async () => {
    const { result } = renderHook(() => useClearCardPosition('bd-1'), { wrapper })
    result.current.mutate('td-a1b2')
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(requests).toContain('/v1/boards/bd-1/issues/td-a1b2')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- --run src/api/boards.test.tsx`
Expected: FAIL — `Failed to resolve import "./boards"`.

- [ ] **Step 3: Add the types**

Append to `web/src/api/types.ts`:

```ts
/**
 * One unresolved blocker. td already filters closed blockers out, so every
 * entry is still in the way.
 */
export interface BlockerRef {
  dep_id: string
  /** The BLOCKER's id, i.e. depends_on_id — not the blocked issue. */
  issue_id: string
  title: string
  status: string
  relation_type: string
}

export interface DependencySummary {
  blockers: BlockerRef[]
}

export type BoardViewMode = 'swimlanes' | 'backlog'

/**
 * `view_mode` is read-only over HTTP: PATCH /v1/boards/{id} accepts name and
 * query only, so td's UpdateBoardViewMode is unreachable. The GUI treats it as
 * the initial view and keeps its own preference.
 */
export interface Board {
  id: string
  name: string
  query: string
  is_builtin: boolean
  view_mode: BoardViewMode
  last_viewed_at: string | null
  created_at: string
  updated_at: string
}

/**
 * One card on a board.
 *
 * `position` is td's sparse sort key (1000, 2000, 1500), NOT an index and NOT
 * the value POST /v1/boards/{id}/issues expects — that one is a 1-based slot.
 * Sort by it; never render it and never send it back.
 *
 * `issue` arrives without description and acceptance (td's slimForBoard) and
 * without available_transitions, which only GET /v1/issues/{id} carries.
 */
export interface BoardCard {
  issue: Issue
  board_id: string
  position: number
  has_position: boolean
}

/** GET /v1/boards */
export interface BoardListResponse {
  boards: Board[]
}

/** GET /v1/boards/{id} */
export interface BoardResponse {
  board: Board
  issues: BoardCard[]
}

/** POST /v1/boards and PATCH /v1/boards/{id} */
export interface BoardCreateResponse {
  board: Board
}
```

In the same file, add one field to `Issue`, directly below `defer_count`:

```ts
  /**
   * Present on the board and list paths only. td also sends `category` there,
   * but nothing in its codebase ever assigns it, so it is always "" and is
   * deliberately not typed here.
   */
  dependency_summary?: DependencySummary
```

- [ ] **Step 4: Add the queries**

Create `web/src/api/boards.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import { apiGet } from './client'
import type { BoardListResponse, BoardResponse } from './types'

export const boardKeys = {
  all: ['boards'] as const,
  list: () => ['boards', 'list'] as const,
  detail: (id: string, includeClosed: boolean) =>
    ['boards', 'detail', id, includeClosed] as const,
}

export function useBoards() {
  return useQuery({
    queryKey: boardKeys.list(),
    queryFn: () => apiGet<BoardListResponse>('/v1/boards'),
  })
}

/**
 * Without `include_closed` td filters the board to open, in_progress, blocked
 * and in_review — so a closed card is genuinely absent, not merely hidden.
 */
export function useBoard(id: string, includeClosed = false) {
  return useQuery({
    queryKey: boardKeys.detail(id, includeClosed),
    queryFn: () => apiGet<BoardResponse>(
      `/v1/boards/${id}${includeClosed ? '?include_closed=true' : ''}`,
    ),
    enabled: id !== '',
  })
}
```

- [ ] **Step 5: Add the mutations**

Append to `web/src/api/mutations.ts`, and extend its import lines with
`boardKeys` from `./boards` and `BoardCreateResponse` from `./types`:

```ts
export interface BoardInput {
  name: string
  query: string
}

export function useCreateBoard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BoardInput) =>
      apiSend<BoardCreateResponse>('POST', '/v1/boards', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: boardKeys.all }),
  })
}

/** td answers 403 `cannot modify builtin board` for is_builtin boards. */
export function useUpdateBoard(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BoardInput) =>
      apiSend<BoardCreateResponse>('PATCH', `/v1/boards/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: boardKeys.all }),
  })
}

export function useDeleteBoard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiSend('DELETE', `/v1/boards/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: boardKeys.all }),
  })
}

/**
 * Pins a card at a slot.
 *
 * `slot` is td's 1-based insert position among the cards that ALREADY have a
 * position — not the index of a rendered row, and not the `position` read back
 * from the board, which is a sparse sort key. features/boards/position.ts owns
 * that conversion.
 */
export function useSetCardPosition(boardId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ issueId, slot }: { issueId: string; slot: number }) =>
      apiSend('POST', `/v1/boards/${boardId}/issues`, {
        issue_id: issueId,
        position: slot,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: boardKeys.all }),
  })
}

/** Unpins a card: it falls back below every positioned card, in query order. */
export function useClearCardPosition(boardId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (issueId: string) =>
      apiSend('DELETE', `/v1/boards/${boardId}/issues/${issueId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: boardKeys.all }),
  })
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd web && npm test -- --run src/api/boards.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add web/src/api/types.ts web/src/api/boards.ts web/src/api/mutations.ts web/src/api/boards.test.tsx
git commit -m "feat(web): board types, queries and mutations"
```

---

### Task 2: insertSlot — the position arithmetic

**Files:**
- Create: `web/src/features/boards/position.ts`
- Test: `web/src/features/boards/position.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `insertSlot(gap: number, cardIndex: number | null): number | null`.

- [ ] **Step 1: Write the failing test**

Create `web/src/features/boards/position.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { insertSlot } from './position'

/*
 * td's ComputeInsertPosition reads the stored rows INCLUDING the card being
 * moved, so a gap is an index into the pinned block as currently rendered and
 * the slot is simply gap + 1. Given pinned [A, B, C] with keys 1000/2000/3000:
 *
 *   slot 1 → before A          (key 0)
 *   slot 2 → between A and B   (key 1500)
 *   slot 3 → between B and C   (key 2500)
 *   slot 4 → after C           (key 4000)
 */
describe('insertSlot', () => {
  it('maps a gap to the slot after it', () => {
    expect(insertSlot(0, null)).toBe(1)
    expect(insertSlot(1, null)).toBe(2)
    expect(insertSlot(3, null)).toBe(4)
  })

  it('treats an unpinned card as having no index of its own', () => {
    // Gap 0 must stay a real move for a card arriving from the auto block.
    expect(insertSlot(0, null)).toBe(1)
  })

  // Dropping a card immediately before or immediately after itself leaves the
  // order untouched: at gap = cardIndex + 1 td interpolates between the card
  // and its successor and the card keeps its place. Issuing that request would
  // rewrite a sort key and possibly trigger a respacing pass for nothing.
  it('reports a no-op when a card is dropped onto its own place', () => {
    expect(insertSlot(1, 1)).toBeNull()
    expect(insertSlot(2, 1)).toBeNull()
    expect(insertSlot(0, 0)).toBeNull()
    expect(insertSlot(1, 0)).toBeNull()
  })

  it('moves a card up by one with the gap before its predecessor', () => {
    // C at index 2 moving up: gap 1 → slot 2 → lands between A and B.
    expect(insertSlot(1, 2)).toBe(2)
  })

  // The asymmetry that makes this function worth having: moving down by one is
  // gap = index + 2, because the card still occupies index + 1's left edge.
  it('moves a card down by one with the gap two below it', () => {
    // A at index 0 moving down: gap 2 → slot 3 → lands between B and C.
    expect(insertSlot(2, 0)).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- --run src/features/boards/position.test.ts`
Expected: FAIL — `Failed to resolve import "./position"`.

- [ ] **Step 3: Write the implementation**

Create `web/src/features/boards/position.ts`:

```ts
/**
 * Where a card lands, as td wants to hear it.
 *
 * `gap` is an index into the pinned block *as currently rendered, including the
 * card being moved* — the card lands before whatever now sits at `gap`, and
 * `gap === pinned.length` appends. td's ComputeInsertPosition reads the stored
 * rows the same way, so the mapping is simply `gap + 1`.
 *
 * `cardIndex` is the card's own index in that block, or null when it is not
 * pinned yet. Returns null for a no-op — dropping a card immediately before or
 * immediately after itself changes nothing, and the request must not be sent.
 *
 * The returned slot is 1-based and counts only cards that already have a
 * position. It is never the `position` field read back from the board, which
 * is a sparse sort key.
 */
export function insertSlot(gap: number, cardIndex: number | null): number | null {
  if (cardIndex !== null && (gap === cardIndex || gap === cardIndex + 1)) return null
  return gap + 1
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- --run src/features/boards/position.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/boards/position.ts web/src/features/boards/position.test.ts
git commit -m "feat(web): map a board drop gap to td's insert slot"
```

---

### Task 3: Board list, route and header link

**Files:**
- Create: `web/src/features/boards/board.fixture.ts`
- Create: `web/src/features/boards/BoardList.tsx`
- Test: `web/src/features/boards/BoardList.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/AppShell.tsx`
- Modify: `web/src/components/AppShell.test.tsx`

**Interfaces:**
- Consumes: `useBoards` (Task 1), `useDeleteBoard` (Task 1), `Board` (Task 1).
- Produces: `makeBoard(over?: Partial<Board>): Board` and `makeCard(over?: Partial<Issue>, position?: {position: number; has_position: boolean}): BoardCard` from `board.fixture.ts`; default export `BoardList`.

- [ ] **Step 1: Write the fixture**

Create `web/src/features/boards/board.fixture.ts`:

```ts
import type { Board, BoardCard, Issue } from '../../api/types'
import { makeIssue } from '../issues/issue.fixture'

/** A complete, boring Board. Tests override only what they care about. */
export function makeBoard(over: Partial<Board> = {}): Board {
  return {
    id: 'bd-sprint1',
    name: 'Sprint 1',
    query: 'priority <= P1',
    is_builtin: false,
    view_mode: 'backlog',
    last_viewed_at: null,
    created_at: '2026-08-16T09:00:00Z',
    updated_at: '2026-08-16T09:00:00Z',
    ...over,
  }
}

/**
 * A card. `position` defaults to a plausible sort key rather than an index, so
 * a test that mistakes one for the other fails loudly.
 */
export function makeCard(
  issue: Partial<Issue> = {},
  over: Partial<Omit<BoardCard, 'issue'>> = {},
): BoardCard {
  return {
    issue: makeIssue(issue),
    board_id: 'bd-sprint1',
    position: 1000,
    has_position: true,
    ...over,
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `web/src/features/boards/BoardList.test.tsx`:

```tsx
import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import BoardList from './BoardList'
import { makeBoard } from './board.fixture'
import type { Board } from '../../api/types'

const deleted: string[] = []

const server = setupServer(
  http.delete('/v1/boards/:id', ({ params }) => {
    deleted.push(String(params.id))
    return HttpResponse.json({ ok: true, data: { deleted: true } })
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  deleted.length = 0
})
afterAll(() => server.close())

function renderList(boards: Board[]) {
  server.use(http.get('/v1/boards', () =>
    HttpResponse.json({ ok: true, data: { boards } })))
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><BoardList /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BoardList', () => {
  it('links each board and shows its query', async () => {
    renderList([makeBoard()])
    // Exact name: the row also holds an "Edit Sprint 1" link, and a regex
    // would match both and throw on the ambiguity.
    const link = await screen.findByRole('link', { name: 'Sprint 1' })
    expect(link).toHaveAttribute('href', '/boards/bd-sprint1')
    expect(screen.getByText('priority <= P1')).toBeInTheDocument()
  })

  // td rejects both with 403, so offering the control would be a dead end.
  it('offers no edit and no delete control on a builtin board', async () => {
    renderList([makeBoard({ id: 'bd-all-issues', name: 'All Issues', query: '', is_builtin: true })])
    expect(await screen.findByText('builtin')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Edit/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument()
  })

  it('deletes a board after confirmation', async () => {
    renderList([makeBoard()])
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Sprint 1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(deleted).toEqual(['bd-sprint1'])
  })

  it('invites creating a board when there are none', async () => {
    renderList([])
    expect(await screen.findByText('No boards yet.')).toBeInTheDocument()
  })

  // A board with no query shows only hand-positioned issues, so saying "all"
  // where td shows nothing would be the GUI inventing a second truth.
  it('marks a board that has no query', async () => {
    renderList([makeBoard({ query: '' })])
    expect(await screen.findByText('no query')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npm test -- --run src/features/boards/BoardList.test.tsx`
Expected: FAIL — `Failed to resolve import "./BoardList"`.

- [ ] **Step 4: Write BoardList**

Create `web/src/features/boards/BoardList.tsx`:

```tsx
import { Link } from 'react-router'
import { useBoards } from '../../api/boards'
import { useDeleteBoard } from '../../api/mutations'
import { unboundMessage } from '../../api/client'
import ConfirmButton from '../../components/ConfirmButton'
import EmptyState from '../../components/EmptyState'
import ErrorPanel from '../../components/ErrorPanel'
import SkeletonRows from '../../components/SkeletonRows'
import { ROW } from '../issues/columns'

export default function BoardList() {
  const { data, error, isPending } = useBoards()
  const remove = useDeleteBoard()
  const removeError = unboundMessage(remove.error)

  if (isPending) return <SkeletonRows />
  if (error) {
    return (
      <div className="p-4">
        <ErrorPanel message={unboundMessage(error) ?? 'Request failed'} />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2.5 border-b border-line bg-surface-inset px-4 py-2">
        <h1 className="text-[11px] uppercase tracking-widest text-ink-muted">Boards</h1>
        <span className="flex-1" />
        <Link to="/boards/new" className="rounded-sm border border-accent px-2.5 py-1 text-[11px] text-accent">
          New board
        </Link>
      </div>

      {removeError && (
        <div className="p-4"><ErrorPanel message={removeError} /></div>
      )}

      {data.boards.length === 0 ? (
        <EmptyState
          message="No boards yet."
          hint="A board is a saved TDQ query — create one, or run td board create."
        />
      ) : (
        <ul>
          {data.boards.map(board => (
            <li key={board.id} className={ROW}>
              <Link to={`/boards/${board.id}`} className="w-56 shrink-0 truncate text-ink">
                {board.name}
              </Link>
              <span className="flex-1 truncate font-mono text-[11px] text-ink-faint">
                {board.query || 'no query'}
              </span>
              {board.is_builtin ? (
                <span className="text-[11px] uppercase tracking-widest text-ink-faint">
                  builtin
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Link
                    to={`/boards/${board.id}/edit`}
                    className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted"
                  >
                    Edit {board.name}
                  </Link>
                  <ConfirmButton
                    label={`Delete ${board.name}`}
                    question="Delete this board?"
                    confirmLabel="Confirm delete"
                    disabled={remove.isPending}
                    onConfirm={() => remove.mutate(board.id)}
                  />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npm test -- --run src/features/boards/BoardList.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Add the route and the header link**

In `web/src/App.tsx`, add the import and the route:

```tsx
import BoardList from './features/boards/BoardList'
```

```tsx
          <Route path="/boards" element={<BoardList />} />
```

In `web/src/components/AppShell.tsx`, add a link immediately before the `New issue` link:

```tsx
        <Link to="/boards" className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted">
          Boards
        </Link>
```

- [ ] **Step 7: Pin the header link**

Append to the existing `describe` in `web/src/components/AppShell.test.tsx`:

```tsx
  it('links to the boards page', () => {
    renderShell()
    expect(screen.getByRole('link', { name: 'Boards' })).toHaveAttribute('href', '/boards')
  })
```

If `AppShell.test.tsx` has no `renderShell` helper, call its existing render
path instead — read the file and follow it rather than introducing a second
pattern.

- [ ] **Step 8: Run the suite**

Run: `cd web && npm test -- --run src/components/AppShell.test.tsx src/features/boards/BoardList.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src/features/boards/ web/src/App.tsx web/src/components/AppShell.tsx web/src/components/AppShell.test.tsx
git commit -m "feat(web): board list page"
```

---

### Task 4: Board create and edit form

**Files:**
- Create: `web/src/features/boards/BoardForm.tsx`
- Test: `web/src/features/boards/BoardForm.test.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `useBoards` (Task 1), `useCreateBoard`, `useUpdateBoard`, `BoardInput` (Task 1), `fieldErrorFor`, `unboundMessage` from `api/client`.
- Produces: default export `BoardForm`, mounted at both `/boards/new` and `/boards/:id/edit`.

- [ ] **Step 1: Write the failing test**

Create `web/src/features/boards/BoardForm.test.tsx`:

```tsx
import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import BoardForm from './BoardForm'
import { makeBoard } from './board.fixture'

const sent: unknown[] = []

const server = setupServer(
  http.get('/v1/boards', () =>
    HttpResponse.json({ ok: true, data: { boards: [makeBoard()] } })),
  http.post('/v1/boards', async ({ request }) => {
    sent.push(await request.json())
    return HttpResponse.json(
      { ok: true, data: { board: makeBoard({ id: 'bd-new' }) } }, { status: 201 })
  }),
  http.patch('/v1/boards/:id', async ({ request }) => {
    sent.push(await request.json())
    return HttpResponse.json({ ok: true, data: { board: makeBoard() } })
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  sent.length = 0
})
afterAll(() => server.close())

function renderForm(path: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/boards/new" element={<BoardForm />} />
          <Route path="/boards/:id/edit" element={<BoardForm />} />
          <Route path="/boards/:id" element={<p>board page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BoardForm', () => {
  it('creates a board from a name and a query', async () => {
    renderForm('/boards/new')
    await userEvent.type(screen.getByLabelText('Name'), 'Bugs')
    await userEvent.type(screen.getByLabelText('Query'), 'type = bug')
    await userEvent.click(screen.getByRole('button', { name: 'Create board' }))
    expect(await screen.findByText('board page')).toBeInTheDocument()
    expect(sent).toEqual([{ name: 'Bugs', query: 'type = bug' }])
  })

  it('starts an edit from the board's stored name and query', async () => {
    renderForm('/boards/bd-sprint1/edit')
    expect(await screen.findByLabelText('Name')).toHaveValue('Sprint 1')
    expect(screen.getByLabelText('Query')).toHaveValue('priority <= P1')
  })

  // td parses TDQ and phrases the failure precisely. The frontend must not
  // pre-empt it with a rule of its own, and must show td's wording at the
  // field it names.
  it('shows td's TDQ message on the query field', async () => {
    server.use(http.post('/v1/boards', () => HttpResponse.json({
      ok: false,
      error: {
        code: 'validation_error',
        message: 'validation failed',
        details: { fields: [{
          field: 'query', rule: 'tdq_syntax', value: 'priorityy <= P1',
          message: 'invalid TDQ query: unknown field "priorityy"',
        }] },
      },
    }, { status: 400 })))

    renderForm('/boards/new')
    await userEvent.type(screen.getByLabelText('Name'), 'Broken')
    await userEvent.type(screen.getByLabelText('Query'), 'priorityy <= P1')
    await userEvent.click(screen.getByRole('button', { name: 'Create board' }))

    expect(await screen.findByText('invalid TDQ query: unknown field "priorityy"'))
      .toBeInTheDocument()
  })

  it('shows an error with no field in the panel', async () => {
    server.use(http.post('/v1/boards', () => HttpResponse.json({
      ok: false, error: { code: 'internal', message: 'failed to create board' },
    }, { status: 500 })))

    renderForm('/boards/new')
    await userEvent.type(screen.getByLabelText('Name'), 'Any')
    await userEvent.click(screen.getByRole('button', { name: 'Create board' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('failed to create board')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- --run src/features/boards/BoardForm.test.tsx`
Expected: FAIL — `Failed to resolve import "./BoardForm"`.

- [ ] **Step 3: Write BoardForm**

Create `web/src/features/boards/BoardForm.tsx`:

```tsx
import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { fieldErrorFor, unboundMessage } from '../../api/client'
import { useBoards } from '../../api/boards'
import { useCreateBoard, useUpdateBoard } from '../../api/mutations'
import ErrorPanel from '../../components/ErrorPanel'
import SkeletonRows from '../../components/SkeletonRows'
import type { Board } from '../../api/types'

const boundFields = ['name', 'query']

/**
 * Serves /boards/new and /boards/:id/edit. Editing waits for the board list —
 * lighter than GET /v1/boards/{id}, which would also fetch every card — and
 * remounts the body by key so the fields initialise from it exactly once.
 */
export default function BoardForm() {
  const { id } = useParams()
  const { data, error, isPending } = useBoards()

  if (id === undefined) return <Body board={null} />
  if (isPending) return <SkeletonRows />
  if (error) {
    return (
      <div className="p-4">
        <ErrorPanel message={unboundMessage(error) ?? 'Request failed'} />
      </div>
    )
  }

  const board = data.boards.find(b => b.id === id)
  if (!board) {
    return <div className="p-4"><ErrorPanel message={`board not found: ${id}`} /></div>
  }
  return <Body key={board.id} board={board} />
}

function Body({ board }: { board: Board | null }) {
  const [name, setName] = useState(board?.name ?? '')
  const [query, setQuery] = useState(board?.query ?? '')
  const create = useCreateBoard()
  const update = useUpdateBoard(board?.id ?? '')
  const navigate = useNavigate()

  const mutation = board ? update : create
  const panelError = unboundMessage(mutation.error, boundFields)

  // Same guard as IssueForm: the disabled attribute reads from state and does
  // not stop a second native submit landing in the same tick.
  const submitting = useRef(false)

  return (
    <form
      className="max-w-xl space-y-4 px-5 py-4"
      onSubmit={e => {
        e.preventDefault()
        if (submitting.current) return
        submitting.current = true
        mutation.mutate(
          { name, query },
          {
            onSuccess: result => navigate(`/boards/${board ? board.id : result.board.id}`),
            onSettled: () => { submitting.current = false },
          },
        )
      }}
    >
      <div>
        <label htmlFor="board-name" className="mb-1.5 block text-[11px] uppercase tracking-widest text-ink-muted">
          Name
        </label>
        <input
          id="board-name" value={name} onChange={e => setName(e.target.value)}
          className="w-full rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink"
        />
        <FieldError error={mutation.error} field="name" />
      </div>

      <div>
        <label htmlFor="board-query" className="mb-1.5 block text-[11px] uppercase tracking-widest text-ink-muted">
          Query
        </label>
        {/* No client-side TDQ parsing: td owns the grammar and phrases the
            failure. An empty query is legal and means "hand-positioned only". */}
        <input
          id="board-query" value={query} onChange={e => setQuery(e.target.value)}
          className="w-full rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 font-mono text-ink"
        />
        <FieldError error={mutation.error} field="query" />
        <p className="mt-1.5 text-[11px] text-ink-faint">
          TDQ, for example <span className="font-mono">priority &lt;= P1 AND type = bug</span>.
          Leave empty to show only hand-positioned issues.
        </p>
      </div>

      <button
        type="submit" disabled={mutation.isPending}
        className="rounded-sm border border-accent px-3 py-1 text-[11px] text-accent disabled:opacity-40"
      >
        {board ? 'Save board' : 'Create board'}
      </button>

      {panelError && <ErrorPanel message={panelError} />}
    </form>
  )
}

function FieldError({ error, field }: { error: unknown; field: string }) {
  const message = fieldErrorFor(error, field)
  if (!message) return null
  return <p className="mt-1.5 text-[11px] text-danger">{message}</p>
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- --run src/features/boards/BoardForm.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the routes**

In `web/src/App.tsx`, add the import and both routes. `/boards/new` must be
listed before `/boards/:id/edit` is irrelevant — react-router ranks static
segments above dynamic ones regardless of order — but keep them together:

```tsx
import BoardForm from './features/boards/BoardForm'
```

```tsx
          <Route path="/boards/new" element={<BoardForm />} />
          <Route path="/boards/:id/edit" element={<BoardForm />} />
```

- [ ] **Step 6: Commit**

```bash
git add web/src/features/boards/BoardForm.tsx web/src/features/boards/BoardForm.test.tsx web/src/App.tsx
git commit -m "feat(web): create and edit boards"
```

---

### Task 5: The board card

**Files:**
- Create: `web/src/features/boards/BoardCard.tsx`
- Test: `web/src/features/boards/BoardCard.test.tsx`

**Interfaces:**
- Consumes: `Issue` (Task 1), `StatusTag`, `PriorityTag`.
- Produces: default export `BoardCard`, props `{ issue: Issue }`.

- [ ] **Step 1: Write the failing test**

Create `web/src/features/boards/BoardCard.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import BoardCard from './BoardCard'
import { makeIssue } from '../issues/issue.fixture'

function renderCard(issue = makeIssue()) {
  render(<MemoryRouter><BoardCard issue={issue} /></MemoryRouter>)
}

describe('BoardCard', () => {
  it('links to the issue and shows its id, title, priority and status', () => {
    renderCard(makeIssue({ id: 'td-a1b2', title: 'Wire up the thing', priority: 'P1', status: 'in_progress' }))
    expect(screen.getByRole('link', { name: /Wire up the thing/ }))
      .toHaveAttribute('href', '/issues/td-a1b2')
    expect(screen.getByText('td-a1b2')).toBeInTheDocument()
    expect(screen.getByText('P1')).toBeInTheDocument()
    expect(screen.getByText('in_progress')).toBeInTheDocument()
  })

  // td already drops closed blockers from this summary, so every entry is
  // still in the way — the count can be shown without further filtering.
  it('counts unresolved blockers and names them', () => {
    renderCard(makeIssue({
      dependency_summary: {
        blockers: [
          { dep_id: 'dep_1', issue_id: 'td-blk1', title: 'One', status: 'open', relation_type: 'depends_on' },
          { dep_id: 'dep_2', issue_id: 'td-blk2', title: 'Two', status: 'in_progress', relation_type: 'depends_on' },
        ],
      },
    }))
    expect(screen.getByLabelText('Blocked by td-blk1, td-blk2')).toHaveTextContent('2')
  })

  it('shows no blocker badge when the summary is absent', () => {
    renderCard(makeIssue())
    expect(screen.queryByLabelText(/Blocked by/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- --run src/features/boards/BoardCard.test.tsx`
Expected: FAIL — `Failed to resolve import "./BoardCard"`.

- [ ] **Step 3: Write BoardCard**

Create `web/src/features/boards/BoardCard.tsx`:

```tsx
import { Link } from 'react-router'
import StatusTag from '../../components/StatusTag'
import PriorityTag from '../../components/PriorityTag'
import type { Issue } from '../../api/types'

/**
 * One card, shared by both board views. The issue arrives without description
 * and acceptance — td slims them out of the board payload — so nothing here
 * may depend on them.
 */
export default function BoardCard({ issue }: { issue: Issue }) {
  const blockers = issue.dependency_summary?.blockers ?? []
  return (
    <Link
      to={`/issues/${issue.id}`}
      className="flex items-center gap-2.5 rounded-sm border border-line bg-surface-inset px-2.5 py-2 hover:bg-surface-hover"
    >
      <span className="w-[74px] shrink-0 font-mono text-[11px] text-ink-faint">{issue.id}</span>
      <span className="flex-1 truncate text-ink">{issue.title}</span>
      {blockers.length > 0 && (
        <span
          aria-label={`Blocked by ${blockers.map(b => b.issue_id).join(', ')}`}
          title={blockers.map(b => `${b.issue_id} ${b.title}`).join('\n')}
          className="shrink-0 font-mono text-[11px] text-danger"
        >
          <span aria-hidden="true">⛔</span> {blockers.length}
        </span>
      )}
      <span className="shrink-0 text-[11px]"><PriorityTag priority={issue.priority} /></span>
      <span className="shrink-0"><StatusTag status={issue.status} /></span>
    </Link>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- --run src/features/boards/BoardCard.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/boards/BoardCard.tsx web/src/features/boards/BoardCard.test.tsx
git commit -m "feat(web): board card with an unresolved-blocker badge"
```

---

### Task 6: Board view shell — loading, view toggle, empty states

**Files:**
- Create: `web/src/features/boards/viewMode.ts`
- Create: `web/src/features/boards/BoardView.tsx`
- Test: `web/src/features/boards/viewMode.test.ts`
- Test: `web/src/features/boards/BoardView.test.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `useBoard` (Task 1), `Board`, `BoardCard`, `BoardViewMode` (Task 1).
- Produces: `readStoredView(boardId)`, `storeView(boardId, view)`, `isViewMode(value)` from `viewMode.ts`; default export `BoardView`. Renders a placeholder body in this task; Tasks 7 and 9 replace it with `BacklogView` and `SwimlaneView`.

- [ ] **Step 1: Write the failing viewMode test**

Create `web/src/features/boards/viewMode.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest'
import { isViewMode, readStoredView, storeView } from './viewMode'

beforeEach(() => localStorage.clear())

describe('viewMode', () => {
  it('recognises only td's two modes', () => {
    expect(isViewMode('backlog')).toBe(true)
    expect(isViewMode('swimlanes')).toBe(true)
    expect(isViewMode('kanban')).toBe(false)
    expect(isViewMode(null)).toBe(false)
  })

  it('stores a preference per board', () => {
    storeView('bd-1', 'swimlanes')
    storeView('bd-2', 'backlog')
    expect(readStoredView('bd-1')).toBe('swimlanes')
    expect(readStoredView('bd-2')).toBe('backlog')
  })

  it('has no preference for a board never toggled', () => {
    expect(readStoredView('bd-unknown')).toBeNull()
  })

  it('ignores a stored value that is not a mode', () => {
    localStorage.setItem('td-gui.board-view.bd-1', 'kanban')
    expect(readStoredView('bd-1')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- --run src/features/boards/viewMode.test.ts`
Expected: FAIL — `Failed to resolve import "./viewMode"`.

- [ ] **Step 3: Write viewMode.ts**

Create `web/src/features/boards/viewMode.ts`:

```ts
import type { BoardViewMode } from '../../api/types'

const PREFIX = 'td-gui.board-view.'

const MODES: BoardViewMode[] = ['backlog', 'swimlanes']

export function isViewMode(value: unknown): value is BoardViewMode {
  return MODES.includes(value as BoardViewMode)
}

/**
 * The user's own choice for this board, or null when they have not made one —
 * in which case the caller falls back to td's board.view_mode.
 *
 * Reading localStorage throws outright in some sandboxed contexts, so an
 * unreadable or unrecognised value degrades to "no preference", as in
 * lib/theme.ts.
 */
export function readStoredView(boardId: string): BoardViewMode | null {
  try {
    const stored = localStorage.getItem(PREFIX + boardId)
    return isViewMode(stored) ? stored : null
  } catch {
    return null
  }
}

export function storeView(boardId: string, view: BoardViewMode): void {
  try {
    localStorage.setItem(PREFIX + boardId, view)
  } catch {
    /* A preference that survives only this tab still beats a crash. */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- --run src/features/boards/viewMode.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing BoardView test**

Create `web/src/features/boards/BoardView.test.tsx`:

```tsx
import { describe, expect, it, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import BoardView from './BoardView'
import { makeBoard, makeCard } from './board.fixture'
import type { Board, BoardCard } from '../../api/types'

const urls: string[] = []
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
beforeEach(() => localStorage.clear())
afterEach(() => {
  server.resetHandlers()
  urls.length = 0
})
afterAll(() => server.close())

function renderBoard(board: Board, issues: BoardCard[], path = '/boards/bd-sprint1') {
  server.use(http.get('/v1/boards/:id', ({ request }) => {
    const url = new URL(request.url)
    urls.push(url.pathname + url.search)
    return HttpResponse.json({ ok: true, data: { board, issues } })
  }))
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/boards/:id" element={<BoardView />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BoardView', () => {
  it('shows the board name and its query', async () => {
    renderBoard(makeBoard(), [makeCard({ id: 'td-a1b2' })])
    expect(await screen.findByRole('heading', { name: 'Sprint 1' })).toBeInTheDocument()
    expect(screen.getByText('priority <= P1')).toBeInTheDocument()
  })

  it('starts in the mode td reports and follows the url instead when it says so', async () => {
    renderBoard(makeBoard({ view_mode: 'swimlanes' }), [])
    expect(await screen.findByRole('button', { name: 'Backlog' }))
      .toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Swimlanes' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('remembers the toggled view for this board', async () => {
    renderBoard(makeBoard({ view_mode: 'swimlanes' }), [])
    await userEvent.click(await screen.findByRole('button', { name: 'Backlog' }))
    expect(localStorage.getItem('td-gui.board-view.bd-sprint1')).toBe('backlog')
  })

  it('refetches with include_closed when asked', async () => {
    renderBoard(makeBoard(), [])
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Include closed' }))
    await screen.findByRole('heading', { name: 'Sprint 1' })
    expect(urls).toContain('/boards/bd-sprint1?include_closed=true')
  })

  // td takes the GetBoardIssues path for an empty query and returns only
  // hand-positioned issues — td board show is equally empty. Saying "no
  // issues match" would suggest a query that does not exist.
  it('explains a board that has no query', async () => {
    renderBoard(makeBoard({ query: '' }), [])
    expect(await screen.findByText(/This board has no query/)).toBeInTheDocument()
  })

  it('offers the closed filter when a board with a query matches nothing', async () => {
    renderBoard(makeBoard(), [])
    expect(await screen.findByText('No issues on this board.')).toBeInTheDocument()
  })

  it('shows td's message when the query fails to execute', async () => {
    server.use(http.get('/v1/boards/:id', () => HttpResponse.json({
      ok: false,
      error: { code: 'internal', message: 'board query error: unknown field "priorityy"' },
    }, { status: 500 })))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/boards/bd-sprint1']}>
          <Routes><Route path="/boards/:id" element={<BoardView />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('alert'))
      .toHaveTextContent('board query error: unknown field "priorityy"')
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd web && npm test -- --run src/features/boards/BoardView.test.tsx`
Expected: FAIL — `Failed to resolve import "./BoardView"`.

- [ ] **Step 7: Write BoardView**

Create `web/src/features/boards/BoardView.tsx`:

```tsx
import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { useBoard } from '../../api/boards'
import { unboundMessage } from '../../api/client'
import EmptyState from '../../components/EmptyState'
import ErrorPanel from '../../components/ErrorPanel'
import SkeletonRows from '../../components/SkeletonRows'
import BoardCard from './BoardCard'
import { isViewMode, readStoredView, storeView } from './viewMode'
import type { BoardViewMode } from '../../api/types'

export default function BoardView() {
  const { id = '' } = useParams()
  const [search, setSearch] = useSearchParams()
  const [includeClosed, setIncludeClosed] = useState(false)
  const { data, error, isPending } = useBoard(id, includeClosed)

  if (isPending) return <SkeletonRows />
  if (error) {
    return (
      <div className="p-4">
        <ErrorPanel message={unboundMessage(error) ?? 'Request failed'} />
      </div>
    )
  }

  const { board, issues } = data

  // Precedence: the url, then this browser's last choice for this board, then
  // td's own view_mode. td's value is a default, not a setting we can write —
  // PATCH /v1/boards/{id} accepts name and query only.
  const param = search.get('view')
  const view: BoardViewMode =
    isViewMode(param) ? param : readStoredView(board.id) ?? board.view_mode

  const setView = (next: BoardViewMode) => {
    storeView(board.id, next)
    const params = new URLSearchParams(search)
    params.set('view', next)
    setSearch(params, { replace: true })
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-surface-inset px-4 py-2">
        <h1 className="text-ink">{board.name}</h1>
        <span className="font-mono text-[11px] text-ink-faint">
          {board.query || 'no query'}
        </span>
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 text-[11px] text-ink-muted">
          <input
            type="checkbox"
            checked={includeClosed}
            onChange={e => setIncludeClosed(e.target.checked)}
          />
          Include closed
        </label>
        <ViewToggle view={view} onChange={setView} />
      </div>

      {board.query === '' ? (
        <EmptyState
          message="This board has no query."
          hint="It shows only issues positioned on it by hand — drag issues here or use td board move."
        />
      ) : issues.length === 0 ? (
        <EmptyState
          message="No issues on this board."
          hint="Nothing matches its query right now. Closed issues are hidden unless you include them."
        />
      ) : (
        <ul className="space-y-1.5 p-4">
          {issues.map(card => (
            <li key={card.issue.id}><BoardCard issue={card.issue} /></li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ViewToggle({
  view, onChange,
}: {
  view: BoardViewMode
  onChange: (next: BoardViewMode) => void
}) {
  const modes: [BoardViewMode, string][] = [['backlog', 'Backlog'], ['swimlanes', 'Swimlanes']]
  return (
    <span className="flex items-center gap-1">
      {modes.map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={view === value}
          onClick={() => onChange(value)}
          className={`rounded-sm border px-2.5 py-1 text-[11px] ${
            view === value ? 'border-accent text-accent' : 'border-line text-ink-muted'
          }`}
        >
          {label}
        </button>
      ))}
    </span>
  )
}
```

Note: the empty-query board renders its explanation even when hand-positioned
cards exist. Guard that when wiring the real views in Task 7 by checking
`issues.length === 0` first; for now the placeholder list is intentionally
unreachable on such a board and Task 7's test pins the corrected order.

- [ ] **Step 8: Run test to verify it passes**

Run: `cd web && npm test -- --run src/features/boards/BoardView.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 9: Add the route**

In `web/src/App.tsx`:

```tsx
import BoardView from './features/boards/BoardView'
```

```tsx
          <Route path="/boards/:id" element={<BoardView />} />
```

- [ ] **Step 10: Commit**

```bash
git add web/src/features/boards/viewMode.ts web/src/features/boards/viewMode.test.ts web/src/features/boards/BoardView.tsx web/src/features/boards/BoardView.test.tsx web/src/App.tsx
git commit -m "feat(web): board view shell with a per-board view toggle"
```

---

### Task 7: Backlog view — the pin boundary and keyboard reordering

**Files:**
- Create: `web/src/features/boards/BacklogView.tsx`
- Test: `web/src/features/boards/BacklogView.test.tsx`
- Modify: `web/src/features/boards/BoardView.tsx`
- Modify: `web/src/features/boards/BoardView.test.tsx`

**Interfaces:**
- Consumes: `insertSlot` (Task 2), `useSetCardPosition`, `useClearCardPosition` (Task 1), `BoardCard` component (Task 5), `BoardCard` type (Task 1).
- Produces: default export `BacklogView`, props `{ boardId: string; cards: BoardCardType[] }`.

- [ ] **Step 1: Write the failing test**

Create `web/src/features/boards/BacklogView.test.tsx`:

```tsx
import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import BacklogView from './BacklogView'
import { makeCard } from './board.fixture'
import type { BoardCard } from '../../api/types'

const positioned: unknown[] = []
const cleared: string[] = []

const server = setupServer(
  http.post('/v1/boards/:id/issues', async ({ request }) => {
    positioned.push(await request.json())
    return HttpResponse.json({ ok: true, data: { positioned: true } })
  }),
  http.delete('/v1/boards/:id/issues/:issueId', ({ params }) => {
    cleared.push(String(params.issueId))
    return HttpResponse.json({ ok: true, data: { deleted: true } })
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  positioned.length = 0
  cleared.length = 0
})
afterAll(() => server.close())

/** Three pinned cards and one that the board query brought in unpositioned. */
function cards(): BoardCard[] {
  return [
    makeCard({ id: 'td-aaa' }, { position: 1000, has_position: true }),
    makeCard({ id: 'td-bbb' }, { position: 2000, has_position: true }),
    makeCard({ id: 'td-ccc' }, { position: 3000, has_position: true }),
    makeCard({ id: 'td-ddd' }, { position: 0, has_position: false }),
  ]
}

function renderBacklog(list: BoardCard[] = cards()) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><BacklogView boardId="bd-sprint1" cards={list} /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BacklogView', () => {
  it('separates pinned cards from the ones the query ordered', () => {
    renderBacklog()
    const pinned = screen.getByRole('list', { name: 'Pinned' })
    const auto = screen.getByRole('list', { name: 'Ordered by the board query' })
    expect(pinned).toHaveTextContent('td-aaa')
    expect(pinned).not.toHaveTextContent('td-ddd')
    expect(auto).toHaveTextContent('td-ddd')
  })

  // Moving down by one is gap = index + 2, because the card still holds
  // index + 1's left edge in td's stored rows. Anything else is a silent no-op.
  it('moves a card down with the slot two below it', async () => {
    renderBacklog()
    await userEvent.click(screen.getByRole('button', { name: 'Move td-aaa down' }))
    expect(positioned).toEqual([{ issue_id: 'td-aaa', position: 3 }])
  })

  it('moves a card up with the gap before its predecessor', async () => {
    renderBacklog()
    await userEvent.click(screen.getByRole('button', { name: 'Move td-ccc up' }))
    expect(positioned).toEqual([{ issue_id: 'td-ccc', position: 2 }])
  })

  it('cannot move the first card up or the last one down', () => {
    renderBacklog()
    expect(screen.getByRole('button', { name: 'Move td-aaa up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move td-ccc down' })).toBeDisabled()
  })

  it('unpins a card', async () => {
    renderBacklog()
    await userEvent.click(screen.getByRole('button', { name: 'Unpin td-bbb' }))
    expect(cleared).toEqual(['td-bbb'])
  })

  // Nothing below the line has an order to move within, so it gets no controls.
  it('offers no move or unpin controls on an unpinned card', () => {
    renderBacklog()
    expect(screen.queryByRole('button', { name: 'Move td-ddd up' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unpin td-ddd' })).not.toBeInTheDocument()
  })

  it('says nothing is pinned yet when no card has a position', () => {
    renderBacklog([makeCard({ id: 'td-ddd' }, { position: 0, has_position: false })])
    expect(screen.getByText(/Nothing is pinned/)).toBeInTheDocument()
  })

  it('shows td's message when a position is rejected', async () => {
    server.use(http.post('/v1/boards/:id/issues', () => HttpResponse.json({
      ok: false, error: { code: 'not_found', message: 'issue not found: td-aaa' },
    }, { status: 404 })))
    renderBacklog()
    await userEvent.click(screen.getByRole('button', { name: 'Move td-aaa down' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('issue not found: td-aaa')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- --run src/features/boards/BacklogView.test.tsx`
Expected: FAIL — `Failed to resolve import "./BacklogView"`.

- [ ] **Step 3: Write BacklogView**

Create `web/src/features/boards/BacklogView.tsx`:

```tsx
import { unboundMessage } from '../../api/client'
import { useClearCardPosition, useSetCardPosition } from '../../api/mutations'
import ErrorPanel from '../../components/ErrorPanel'
import BoardCard from './BoardCard'
import { insertSlot } from './position'
import type { BoardCard as Card } from '../../api/types'

interface Props {
  boardId: string
  cards: Card[]
}

/**
 * The flat, ordered view of a board.
 *
 * td stores one position sequence per board, and cards without a position
 * always sort after every card that has one. That boundary is drawn on screen
 * rather than hidden: above it the order is stored and editable, below it the
 * order is whatever the board query returned and nothing can be moved within
 * it.
 */
export default function BacklogView({ boardId, cards }: Props) {
  const pinned = cards.filter(c => c.has_position)
  const auto = cards.filter(c => !c.has_position)

  const setPosition = useSetCardPosition(boardId)
  const clearPosition = useClearCardPosition(boardId)
  const busy = setPosition.isPending || clearPosition.isPending
  const message = unboundMessage(setPosition.error ?? clearPosition.error)

  /** No optimistic move: td computes the sort key and may respace the board. */
  const move = (issueId: string, slot: number | null) => {
    if (slot === null) return
    setPosition.mutate({ issueId, slot })
  }

  return (
    <div className="space-y-4 p-4">
      {message && <ErrorPanel message={message} />}

      <section>
        <h2 className="mb-1.5 text-[11px] uppercase tracking-widest text-ink-muted">Pinned</h2>
        {pinned.length === 0 ? (
          <p className="text-[11px] text-ink-faint">
            Nothing is pinned. Drag a card up here to give it a stored position.
          </p>
        ) : (
          <ul aria-label="Pinned" aria-busy={busy} className="space-y-1.5">
            {pinned.map((card, index) => (
              <li key={card.issue.id} className="flex items-center gap-1.5">
                <span className="flex-1"><BoardCard issue={card.issue} /></span>
                <button
                  type="button"
                  aria-label={`Move ${card.issue.id} up`}
                  disabled={busy || index === 0}
                  onClick={() => move(card.issue.id, insertSlot(index - 1, index))}
                  className="rounded-sm border border-line px-2 py-1 text-[11px] text-ink-muted disabled:opacity-40"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${card.issue.id} down`}
                  disabled={busy || index === pinned.length - 1}
                  // gap = index + 2, not index + 1: at index + 1 td interpolates
                  // between the card and its successor and it keeps its place.
                  onClick={() => move(card.issue.id, insertSlot(index + 2, index))}
                  className="rounded-sm border border-line px-2 py-1 text-[11px] text-ink-muted disabled:opacity-40"
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Unpin ${card.issue.id}`}
                  disabled={busy}
                  onClick={() => clearPosition.mutate(card.issue.id)}
                  className="rounded-sm border border-line px-2 py-1 text-[11px] text-ink-muted disabled:opacity-40"
                >
                  Unpin
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1.5 border-t border-line-subtle pt-3 text-[11px] uppercase tracking-widest text-ink-faint">
          Ordered by the board query
        </h2>
        {auto.length === 0 ? (
          <p className="text-[11px] text-ink-faint">Every matching issue is pinned.</p>
        ) : (
          <ul aria-label="Ordered by the board query" className="space-y-1.5">
            {auto.map(card => (
              <li key={card.issue.id}><BoardCard issue={card.issue} /></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- --run src/features/boards/BacklogView.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Wire it into BoardView**

In `web/src/features/boards/BoardView.tsx`, replace the placeholder `<ul>` and
reorder the empty-state branches so a hand-positioned card on a query-less
board is still reachable:

```tsx
import BacklogView from './BacklogView'
```

```tsx
      {issues.length === 0 ? (
        board.query === '' ? (
          <EmptyState
            message="This board has no query."
            hint="It shows only issues positioned on it by hand — drag issues here or use td board move."
          />
        ) : (
          <EmptyState
            message="No issues on this board."
            hint="Nothing matches its query right now. Closed issues are hidden unless you include them."
          />
        )
      ) : view === 'backlog' ? (
        <BacklogView boardId={board.id} cards={issues} />
      ) : (
        <p className="p-4 text-ink-muted">Swimlanes arrive in the next task.</p>
      )}
```

- [ ] **Step 6: Pin the corrected branch order**

Add to `web/src/features/boards/BoardView.test.tsx`:

```tsx
  // A query-less board is not necessarily empty: it shows whatever was pinned
  // by hand. The explanation belongs to the empty case only.
  it('renders pinned cards on a board that has no query', async () => {
    renderBoard(makeBoard({ query: '' }), [makeCard({ id: 'td-aaa' })])
    expect(await screen.findByText('td-aaa')).toBeInTheDocument()
    expect(screen.queryByText(/This board has no query/)).not.toBeInTheDocument()
  })
```

Add `makeCard` to that file's import from `./board.fixture`.

- [ ] **Step 7: Run both suites**

Run: `cd web && npm test -- --run src/features/boards/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/features/boards/BacklogView.tsx web/src/features/boards/BacklogView.test.tsx web/src/features/boards/BoardView.tsx web/src/features/boards/BoardView.test.tsx
git commit -m "feat(web): backlog view with a visible pin boundary"
```

---

### Task 8: Drag and drop in the backlog view

**Files:**
- Modify: `web/src/features/boards/BacklogView.tsx`
- Modify: `web/src/features/boards/BacklogView.test.tsx`

**Interfaces:**
- Consumes: everything from Task 7.
- Produces: no new exports. Drop zones carry `data-testid="drop-gap-<n>"`.

- [ ] **Step 1: Write the failing test**

Append to `describe('BacklogView', …)` in `web/src/features/boards/BacklogView.test.tsx`:

```tsx
  /**
   * jsdom implements neither DataTransfer nor the drag lifecycle, so the
   * exchange is stubbed. That is the whole contract the component relies on:
   * the issue id goes out on dragstart and comes back on drop.
   */
  function dataTransfer(id: string) {
    const store: Record<string, string> = { 'text/plain': id }
    return {
      dropEffect: '', effectAllowed: '',
      setData: (type: string, value: string) => { store[type] = value },
      getData: (type: string) => store[type] ?? '',
    }
  }

  it('drops a pinned card into a higher gap', async () => {
    renderBacklog()
    const dt = dataTransfer('td-ccc')
    fireEvent.dragStart(screen.getByText('td-ccc').closest('li')!, { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('drop-gap-1'), { dataTransfer: dt })
    await waitFor(() => expect(positioned).toEqual([{ issue_id: 'td-ccc', position: 2 }]))
  })

  it('pins a card dragged up from the query-ordered block', async () => {
    renderBacklog()
    const dt = dataTransfer('td-ddd')
    fireEvent.dragStart(screen.getByText('td-ddd').closest('li')!, { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('drop-gap-0'), { dataTransfer: dt })
    await waitFor(() => expect(positioned).toEqual([{ issue_id: 'td-ddd', position: 1 }]))
  })

  it('appends a card dropped at the end of the pinned block', async () => {
    renderBacklog()
    const dt = dataTransfer('td-ddd')
    fireEvent.dragStart(screen.getByText('td-ddd').closest('li')!, { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('drop-gap-3'), { dataTransfer: dt })
    await waitFor(() => expect(positioned).toEqual([{ issue_id: 'td-ddd', position: 4 }]))
  })

  // Dropping a card onto its own place would rewrite a sort key and can
  // trigger a respacing pass in td, all to leave the order exactly as it was.
  it('sends nothing when a card is dropped onto its own place', async () => {
    renderBacklog()
    const dt = dataTransfer('td-bbb')
    fireEvent.dragStart(screen.getByText('td-bbb').closest('li')!, { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('drop-gap-1'), { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('drop-gap-2'), { dataTransfer: dt })
    expect(positioned).toEqual([])
  })

  // Without preventDefault on dragover the browser refuses the drop outright.
  it('accepts the drag over a gap', () => {
    renderBacklog()
    const event = createEvent.dragOver(screen.getByTestId('drop-gap-0'), {
      dataTransfer: dataTransfer('td-ddd'),
    })
    fireEvent(screen.getByTestId('drop-gap-0'), event)
    expect(event.defaultPrevented).toBe(true)
  })
```

Extend that file's Testing Library import to
`import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- --run src/features/boards/BacklogView.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="drop-gap-1"]`.

- [ ] **Step 3: Add the drag handlers**

In `web/src/features/boards/BacklogView.tsx`, add the import and the drag state
inside the component:

```tsx
import { useState } from 'react'
```

```tsx
  const [dragging, setDragging] = useState<string | null>(null)

  /** The dragged card's index in the pinned block, or null when unpinned. */
  const pinnedIndexOf = (issueId: string) => {
    const index = pinned.findIndex(c => c.issue.id === issueId)
    return index === -1 ? null : index
  }

  const dropAt = (gap: number) => (event: React.DragEvent) => {
    event.preventDefault()
    const issueId = event.dataTransfer.getData('text/plain') || dragging
    setDragging(null)
    if (!issueId) return
    move(issueId, insertSlot(gap, pinnedIndexOf(issueId)))
  }
```

Add a `DropGap` helper below the component:

```tsx
/**
 * A drop target between two pinned cards. Decorative for assistive tech — the
 * keyboard path is the Move up/down buttons, which are real controls with real
 * names — so it is aria-hidden and addressed by test id.
 */
function DropGap({ gap, onDrop }: { gap: number; onDrop: (e: React.DragEvent) => void }) {
  return (
    <li
      aria-hidden="true"
      data-testid={`drop-gap-${gap}`}
      onDragOver={e => {
        // Without this the browser rejects the drop and no drop event fires.
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={onDrop}
      className="h-1.5 rounded-sm"
    />
  )
}
```

Import the `DragEvent` type at the top:

```tsx
import type { DragEvent } from 'react'
```

and use `DragEvent` rather than `React.DragEvent` in both signatures.

- [ ] **Step 4: Render the gaps and make the cards draggable**

Replace the pinned `<ul>` body so a gap precedes every card and one trails the
block, and give both lists' `<li>` elements a drag start:

```tsx
          <ul aria-label="Pinned" aria-busy={busy} className="space-y-1.5">
            {pinned.map((card, index) => (
              <Fragment key={card.issue.id}>
                <DropGap gap={index} onDrop={dropAt(index)} />
                <li
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.setData('text/plain', card.issue.id)
                    e.dataTransfer.effectAllowed = 'move'
                    setDragging(card.issue.id)
                  }}
                  onDragEnd={() => setDragging(null)}
                  className="flex items-center gap-1.5"
                >
                  {/* The BoardCard span and the three buttons from Task 7,
                      carried over verbatim — this step adds the wrapper's drag
                      attributes and changes nothing inside it. */}
                </li>
              </Fragment>
            ))}
            <DropGap gap={pinned.length} onDrop={dropAt(pinned.length)} />
          </ul>
```

The auto list's `<li>` gets the same `draggable`, `onDragStart` and `onDragEnd`.
When `pinned.length === 0` the placeholder paragraph replaces the whole list, so
render a bare `<ul aria-label="Pinned">` holding only `<DropGap gap={0} …>`
alongside it — otherwise the first card can never be pinned by dragging.

Import `Fragment` from react.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npm test -- --run src/features/boards/BacklogView.test.tsx`
Expected: PASS, 13 tests.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/boards/BacklogView.tsx web/src/features/boards/BacklogView.test.tsx
git commit -m "feat(web): drag and drop reordering on the backlog view"
```

---

### Task 9: Swimlane view and the transition panel

**Files:**
- Create: `web/src/features/boards/BoardTransitionPanel.tsx`
- Create: `web/src/features/boards/SwimlaneView.tsx`
- Test: `web/src/features/boards/BoardTransitionPanel.test.tsx`
- Test: `web/src/features/boards/SwimlaneView.test.tsx`
- Modify: `web/src/features/boards/BoardView.tsx`

**Interfaces:**
- Consumes: `useIssue` from `api/queries`, `TransitionBar` from `../issues/TransitionBar`, `BoardCard` component (Task 5), `IssueStatus` (existing type).
- Produces: default exports `SwimlaneView` (props `{ cards: BoardCardType[] }`) and `BoardTransitionPanel` (props `{ issueId: string; droppedOn: IssueStatus; onClose: () => void }`).

- [ ] **Step 1: Write the failing panel test**

Create `web/src/features/boards/BoardTransitionPanel.test.tsx`:

```tsx
import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import BoardTransitionPanel from './BoardTransitionPanel'
import { makeIssue } from '../issues/issue.fixture'
import type { Transition } from '../../api/types'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderPanel(available?: Transition[]) {
  server.use(http.get('/v1/issues/:id', () => HttpResponse.json({
    ok: true,
    data: {
      issue: makeIssue({ id: 'td-aaa', available_transitions: available }),
      logs: [], comments: [], dependencies: [], blocked_by: [], latest_handoff: null,
    },
  })))
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BoardTransitionPanel issueId="td-aaa" droppedOn="in_review" onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BoardTransitionPanel', () => {
  it('names the column the card was dropped on', async () => {
    renderPanel(['review'])
    expect(await screen.findByText('Dropped on: In review')).toBeInTheDocument()
  })

  // Board cards carry no available_transitions — the panel must fetch the
  // issue rather than guess an action from the target column, which is
  // ambiguous in both directions (closed ← approve or close).
  it('offers exactly the transitions td reported', async () => {
    renderPanel(['review', 'block'])
    expect(await screen.findByRole('button', { name: 'Request review' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Block' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('says so when td reports none', async () => {
    renderPanel([])
    expect(await screen.findByText(/no transitions available/i)).toBeInTheDocument()
  })

  it('says so when td omits the field entirely', async () => {
    renderPanel(undefined)
    expect(await screen.findByText(/no transitions available/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- --run src/features/boards/BoardTransitionPanel.test.tsx`
Expected: FAIL — `Failed to resolve import "./BoardTransitionPanel"`.

- [ ] **Step 3: Write the panel**

Create `web/src/features/boards/BoardTransitionPanel.tsx`:

```tsx
import { useIssue } from '../../api/queries'
import { unboundMessage } from '../../api/client'
import ErrorPanel from '../../components/ErrorPanel'
import SkeletonRows from '../../components/SkeletonRows'
import TransitionBar from '../issues/TransitionBar'
import type { IssueStatus } from '../../api/types'

export const STATUS_LABEL: Record<IssueStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  in_review: 'In review',
  closed: 'Closed',
}

interface Props {
  issueId: string
  droppedOn: IssueStatus
  onClose: () => void
}

/**
 * What a cross-column drop opens.
 *
 * It deliberately does not infer an action from the target column: `closed`
 * follows both approve and close, `open` follows reopen, reject and unblock,
 * and td publishes no transition-to-status table. The column is stated, the
 * choice stays with the actions td itself reported — which is also why the
 * issue has to be fetched, since board cards carry no available_transitions.
 */
export default function BoardTransitionPanel({ issueId, droppedOn, onClose }: Props) {
  const { data, error, isPending } = useIssue(issueId)

  return (
    <div
      role="dialog"
      aria-label={`Move ${issueId}`}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}
      className="border-t border-line bg-surface-inset px-4 py-3"
    >
      <div className="flex items-center gap-2.5">
        <p className="text-[11px] uppercase tracking-widest text-ink-muted">
          Dropped on: {STATUS_LABEL[droppedOn]}
        </p>
        <span className="flex-1" />
        <button
          type="button" onClick={onClose}
          className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted"
        >
          Close
        </button>
      </div>

      {isPending && <SkeletonRows />}
      {error && <ErrorPanel message={unboundMessage(error) ?? 'Request failed'} />}
      {data && (
        data.issue.available_transitions?.length ? (
          <TransitionBar issueId={issueId} available={data.issue.available_transitions} />
        ) : (
          <p className="mt-2 text-[11px] text-ink-faint">
            td reports no transitions available for {issueId}.
          </p>
        )
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- --run src/features/boards/BoardTransitionPanel.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing swimlane test**

Create `web/src/features/boards/SwimlaneView.test.tsx`:

```tsx
import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import SwimlaneView from './SwimlaneView'
import { makeCard } from './board.fixture'
import { makeIssue } from '../issues/issue.fixture'
import type { BoardCard } from '../../api/types'

const server = setupServer(
  http.get('/v1/issues/:id', () => HttpResponse.json({
    ok: true,
    data: {
      issue: makeIssue({ id: 'td-aaa', available_transitions: ['review'] }),
      logs: [], comments: [], dependencies: [], blocked_by: [], latest_handoff: null,
    },
  })),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function dataTransfer(id: string) {
  const store: Record<string, string> = { 'text/plain': id }
  return {
    dropEffect: '', effectAllowed: '',
    setData: (type: string, value: string) => { store[type] = value },
    getData: (type: string) => store[type] ?? '',
  }
}

function renderSwimlanes(cards: BoardCard[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><SwimlaneView cards={cards} /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SwimlaneView', () => {
  it('puts each card in its status column', () => {
    renderSwimlanes([
      makeCard({ id: 'td-aaa', status: 'open' }),
      makeCard({ id: 'td-bbb', status: 'in_progress' }),
    ])
    expect(screen.getByRole('region', { name: 'Open' })).toHaveTextContent('td-aaa')
    expect(screen.getByRole('region', { name: 'In progress' })).toHaveTextContent('td-bbb')
  })

  it('shows the closed column only when a closed card is on the board', () => {
    renderSwimlanes([makeCard({ id: 'td-aaa', status: 'open' })])
    expect(screen.queryByRole('region', { name: 'Closed' })).not.toBeInTheDocument()
  })

  it('shows the closed column once a closed card is included', () => {
    renderSwimlanes([
      makeCard({ id: 'td-aaa', status: 'open' }),
      makeCard({ id: 'td-zzz', status: 'closed' }),
    ])
    expect(screen.getByRole('region', { name: 'Closed' })).toHaveTextContent('td-zzz')
  })

  it('opens the transition panel on a cross-column drop', async () => {
    renderSwimlanes([makeCard({ id: 'td-aaa', status: 'open' })])
    const dt = dataTransfer('td-aaa')
    fireEvent.dragStart(screen.getByText('td-aaa').closest('li')!, { dataTransfer: dt })
    fireEvent.drop(screen.getByRole('region', { name: 'In review' }), { dataTransfer: dt })

    expect(await screen.findByRole('dialog', { name: 'Move td-aaa' })).toBeInTheDocument()
    expect(screen.getByText('Dropped on: In review')).toBeInTheDocument()
  })

  // td stores one position sequence per board, not one per column, so a drop
  // inside a column has no order to write and must do nothing at all.
  it('does nothing when a card is dropped on its own column', () => {
    renderSwimlanes([makeCard({ id: 'td-aaa', status: 'open' })])
    const dt = dataTransfer('td-aaa')
    fireEvent.dragStart(screen.getByText('td-aaa').closest('li')!, { dataTransfer: dt })
    fireEvent.drop(screen.getByRole('region', { name: 'Open' }), { dataTransfer: dt })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd web && npm test -- --run src/features/boards/SwimlaneView.test.tsx`
Expected: FAIL — `Failed to resolve import "./SwimlaneView"`.

- [ ] **Step 7: Write SwimlaneView**

Create `web/src/features/boards/SwimlaneView.tsx`:

```tsx
import { useState } from 'react'
import type { DragEvent } from 'react'
import BoardCard from './BoardCard'
import BoardTransitionPanel, { STATUS_LABEL } from './BoardTransitionPanel'
import type { BoardCard as Card, IssueStatus } from '../../api/types'

/** Without include_closed td filters the board to the first four. */
const COLUMNS: IssueStatus[] = ['open', 'in_progress', 'blocked', 'in_review', 'closed']

/**
 * The board as status columns.
 *
 * Reordering is deliberately absent: td stores one position sequence per board,
 * so an order written inside a column would also order that card against every
 * card in every other column. Dragging here means one thing only — a status
 * change — and even that is proposed rather than performed.
 */
export default function SwimlaneView({ cards }: { cards: Card[] }) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [pending, setPending] = useState<{ issueId: string; status: IssueStatus } | null>(null)

  const columns = COLUMNS.filter(
    status => status !== 'closed' || cards.some(c => c.issue.status === 'closed'),
  )

  const dropOn = (status: IssueStatus) => (event: DragEvent) => {
    event.preventDefault()
    const issueId = event.dataTransfer.getData('text/plain') || dragging
    setDragging(null)
    if (!issueId) return
    const card = cards.find(c => c.issue.id === issueId)
    // A drop inside the card's own column has nothing to propose.
    if (!card || card.issue.status === status) return
    setPending({ issueId, status })
  }

  return (
    <div>
      <div className="flex gap-2.5 overflow-x-auto p-4">
        {columns.map(status => (
          <section
            key={status}
            role="region"
            aria-label={STATUS_LABEL[status]}
            onDragOver={e => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
            }}
            onDrop={dropOn(status)}
            className="w-64 shrink-0 rounded-sm border border-line p-2"
          >
            <h2 className="mb-1.5 text-[11px] uppercase tracking-widest text-ink-muted">
              {STATUS_LABEL[status]}
            </h2>
            <ul className="space-y-1.5">
              {cards.filter(c => c.issue.status === status).map(card => (
                <li
                  key={card.issue.id}
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.setData('text/plain', card.issue.id)
                    e.dataTransfer.effectAllowed = 'move'
                    setDragging(card.issue.id)
                  }}
                  onDragEnd={() => setDragging(null)}
                >
                  <BoardCard issue={card.issue} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {pending && (
        <BoardTransitionPanel
          issueId={pending.issueId}
          droppedOn={pending.status}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd web && npm test -- --run src/features/boards/SwimlaneView.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 9: Wire it into BoardView**

In `web/src/features/boards/BoardView.tsx`, replace the swimlane placeholder:

```tsx
import SwimlaneView from './SwimlaneView'
```

```tsx
      ) : (
        <SwimlaneView cards={issues} />
      )}
```

- [ ] **Step 10: Run the whole frontend suite**

Run: `cd web && npm test -- --run`
Expected: PASS, no regressions in the issue suites.

- [ ] **Step 11: Commit**

```bash
git add web/src/features/boards/SwimlaneView.tsx web/src/features/boards/SwimlaneView.test.tsx web/src/features/boards/BoardTransitionPanel.tsx web/src/features/boards/BoardTransitionPanel.test.tsx web/src/features/boards/BoardView.tsx
git commit -m "feat(web): swimlane view whose drop opens td's transitions"
```

---

### Task 10: Contract test for the position slot

**Files:**
- Modify: `test/contract/contract_test.go`

**Interfaces:**
- Consumes: `newProject`, `getJSON`, `post`, `jsonBody` — all already in that file.
- Produces: `postJSON` helper; `TestBoardPositionSlotContract`.

- [ ] **Step 1: Write the failing test**

Append to `test/contract/contract_test.go`:

```go
// postJSON posts and decodes the envelope, for the endpoints whose response
// body the caller needs rather than only its status.
func postJSON(t *testing.T, url, body string, into any) int {
	t.Helper()
	resp, err := http.Post(url, "application/json", jsonBody(body))
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()
	if into != nil {
		if err := json.NewDecoder(resp.Body).Decode(into); err != nil {
			t.Fatalf("decode %s: %v", url, err)
		}
	}
	return resp.StatusCode
}

// TestBoardPositionSlotContract pins the one thing the boards UI computes:
// POST /v1/boards/{id}/issues takes a 1-BASED SLOT among the cards that
// already have a position, while the position read back from the board is a
// sparse sort key (1000, 2000, 1500). Sending slot 1 must put a card first.
//
// It also pins the response shape the cards are built from: issues[].issue and
// issues[].has_position. A rename in td must fail here rather than surface as
// an undefined card in the UI.
func TestBoardPositionSlotContract(t *testing.T) {
	front, first := newProject(t)

	if status := post(t, front+"/v1/issues",
		`{"title":"Second contract issue with a long enough title","type":"feature","priority":"P1"}`,
	); status != http.StatusCreated && status != http.StatusOK {
		t.Fatalf("create second issue status = %d", status)
	}
	second := otherIssue(t, front, first)

	var created struct {
		Data struct {
			Board struct {
				ID string `json:"id"`
			} `json:"board"`
		} `json:"data"`
	}
	if status := postJSON(t, front+"/v1/boards",
		`{"name":"Contract board","query":"type = feature"}`, &created,
	); status != http.StatusCreated {
		t.Fatalf("create board status = %d, want 201", status)
	}
	board := created.Data.Board.ID
	if board == "" {
		t.Fatal("created board has no id — POST /v1/boards nests it under `board`")
	}

	// Pin the second issue first, then push the first issue in front of it.
	// Both calls use slot 1, which is what makes the slot semantics visible:
	// the value is not an index into anything the caller rendered.
	if status := post(t, front+"/v1/boards/"+board+"/issues",
		`{"issue_id":"`+second+`","position":1}`); status != http.StatusOK {
		t.Fatalf("position second status = %d, want 200", status)
	}
	if status := post(t, front+"/v1/boards/"+board+"/issues",
		`{"issue_id":"`+first+`","position":1}`); status != http.StatusOK {
		t.Fatalf("position first status = %d, want 200", status)
	}

	var got struct {
		Data struct {
			Board  map[string]json.RawMessage `json:"board"`
			Issues []struct {
				Issue struct {
					ID string `json:"id"`
				} `json:"issue"`
				HasPosition *bool `json:"has_position"`
			} `json:"issues"`
		} `json:"data"`
	}
	getJSON(t, front+"/v1/boards/"+board, &got)

	for _, field := range []string{"id", "name", "query", "is_builtin", "view_mode"} {
		if _, ok := got.Data.Board[field]; !ok {
			t.Errorf("board is missing %q", field)
		}
	}

	if len(got.Data.Issues) < 2 {
		t.Fatalf("board returned %d issues, want at least 2", len(got.Data.Issues))
	}
	if got.Data.Issues[0].Issue.ID != first {
		t.Errorf("first card = %q, want %q — slot 1 must place a card at the front",
			got.Data.Issues[0].Issue.ID, first)
	}
	if got.Data.Issues[1].Issue.ID != second {
		t.Errorf("second card = %q, want %q", got.Data.Issues[1].Issue.ID, second)
	}
	for i, card := range got.Data.Issues[:2] {
		if card.HasPosition == nil || !*card.HasPosition {
			t.Errorf("card %d has_position = %v, want true", i, card.HasPosition)
		}
	}
}
```

- [ ] **Step 2: Confirm td is on PATH**

Run: `td --version`
Expected: v0.57.0 or newer. `newProject` skips the whole contract package when
`td` is missing, and `go test ./...` still prints `ok` for a package that
skipped — a green run would verify nothing here.

This test pins an external contract rather than code written in this repo, so
unlike every other task it is expected to pass on its first run. The failure it
exists to catch is a future td release changing the slot semantics.

- [ ] **Step 3: Run the test**

Run: `go test ./test/contract/ -run TestBoardPositionSlotContract -v`
Expected: PASS, and **not** `--- SKIP`.

If it fails on the ordering assertion, stop and do not adjust the assertion:
`insertSlot` in Task 2 encodes exactly this contract, and a real change in td
means the frontend arithmetic has to change with it.

- [ ] **Step 4: Run the full build and suite**

Run: `make test`
Expected: lint clean, Go tests pass, frontend suite passes. Check the output for
`--- SKIP` on `test/contract` before trusting it.

- [ ] **Step 5: Commit**

```bash
git add test/contract/contract_test.go
git commit -m "test: pin td's board position slot semantics"
```

---

## Verification

After Task 10, confirm end to end rather than by inference:

- [ ] `make test` is green and `test/contract` did **not** skip.
- [ ] `make build`, then run the binary in a project that has a board with a query, and check: the board list, reordering by drag and by the Move buttons, Unpin, the swimlane drop opening the transition panel, and the `bd-all-issues` explanation.
- [ ] `td board show <name>` and the GUI agree on the order after a drag.
