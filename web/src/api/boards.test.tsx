import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { useBoard, useBoards } from './boards'
import {
  useCreateBoard, useCreateIssue, useClearCardPosition, useMoveCard, useTransition,
} from './mutations'

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

  /** One client for the whole hook, so a rerender reads the same cache. */
  function stableWrapper() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
  }

  // include_closed is part of the query key, so ticking the box lands on a key
  // with nothing cached. Holding the previous answer keeps isPending false and
  // BoardView's chrome — the checkbox being ticked included — mounted.
  it('holds the previous answer while the same board refetches', async () => {
    const { result, rerender } = renderHook(
      ({ closed }) => useBoard('bd-1', closed),
      { wrapper: stableWrapper(), initialProps: { closed: false } },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    rerender({ closed: true })
    expect(result.current.isPending).toBe(false)
    expect(result.current.data).toBeDefined()
  })

  // But only for the same board. /boards/:id keeps BoardView mounted across an
  // id change, so an unscoped keepPreviousData would render one board's name
  // and cards under another board's url until the fetch landed.
  it('does not hold one board over another', async () => {
    const { result, rerender } = renderHook(
      ({ id }) => useBoard(id),
      { wrapper: stableWrapper(), initialProps: { id: 'bd-1' } },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    rerender({ id: 'bd-2' })
    expect(result.current.data).toBeUndefined()
    expect(result.current.isPending).toBe(true)
  })
})

describe('board mutations', () => {
  it('sends name and query when creating a board', async () => {
    const { result } = renderHook(() => useCreateBoard(), { wrapper })
    result.current.mutate({ name: 'Sprint 1', query: 'priority <= P1' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(bodies[0]).toEqual({ name: 'Sprint 1', query: 'priority <= P1' })
  })

  // include_closed must match the list the user was looking at: td resolves
  // before_id against the same task list GET /v1/boards/{id} returned.
  it('moves a card before another through the move endpoint', async () => {
    server.use(
      http.post('/v1/boards/:id/move', async ({ request, params }) => {
        requests.push(`move ${String(params.id)}`)
        bodies.push(await request.json())
        return HttpResponse.json({ ok: true, data: { positioned: true } })
      }),
    )
    const { result } = renderHook(() => useMoveCard('bd-1', true), { wrapper })
    result.current.mutate({ issueId: 'td-a1b2', beforeId: 'td-c3d4' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(requests).toContain('move bd-1')
    expect(bodies).toEqual([{ issue_id: 'td-a1b2', before_id: 'td-c3d4', include_closed: true }])
  })

  // td answers 409 when the card, or the one it should land before, has left
  // the board since it was rendered. The board on screen is the stale part, so
  // it is fetched again rather than left to describe a list td no longer has.
  it('refetches the board when td reports the board changed under the move', async () => {
    server.use(
      http.post('/v1/boards/:id/move', () => HttpResponse.json({
        ok: false,
        error: { code: 'conflict', message: 'The task or the task it should be placed before is no longer on this board. Refresh the board and try again.' },
      }, { status: 409 })),
    )
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const shared = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const board = renderHook(() => useBoard('bd-1'), { wrapper: shared })
    await waitFor(() => expect(board.result.current.isSuccess).toBe(true))
    const fetches = requests.filter(r => r === '/v1/boards/bd-1').length

    const { result } = renderHook(() => useMoveCard('bd-1', false), { wrapper: shared })
    result.current.mutate({ issueId: 'td-a1b2', beforeId: 'td-c3d4' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toMatch(/no longer on this board/)
    await waitFor(() =>
      expect(requests.filter(r => r === '/v1/boards/bd-1').length).toBe(fetches + 1))
  })

  it('clears a position by issue id', async () => {
    const { result } = renderHook(() => useClearCardPosition('bd-1'), { wrapper })
    result.current.mutate('td-a1b2')
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(requests).toContain('/v1/boards/bd-1/issues/td-a1b2')
  })
})

/**
 * A board is a projection of issues, so a mutation that changes issue data
 * leaves the board cache stale unless it invalidates boardKeys as well. Only
 * useLiveUpdates' blanket invalidation on td's SSE refresh would repair it
 * otherwise, and that stream is not guaranteed — AppShell renders a
 * "disconnected" banner precisely because it can drop.
 */
describe('issue mutations and the board cache', () => {
  /** One client for the whole test, so the mounted board query is invalidated. */
  function sharedWrapper() {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
  }

  const boardFetches = () => requests.filter(r => r === '/v1/boards/bd-1').length

  async function withMountedBoard() {
    const wrap = sharedWrapper()
    const board = renderHook(() => useBoard('bd-1'), { wrapper: wrap })
    await waitFor(() => expect(board.result.current.isSuccess).toBe(true))
    expect(boardFetches()).toBe(1)
    return wrap
  }

  // The user drops a card on "In review" and confirms: without this the card
  // sits in its old column until something else refetches the board.
  it('refetches the board after a transition', async () => {
    server.use(http.post('/v1/issues/:id/start', () =>
      HttpResponse.json({ ok: true, data: {} })))
    const wrap = await withMountedBoard()

    const { result } = renderHook(() => useTransition('td-a1b2'), { wrapper: wrap })
    result.current.mutate({ action: 'start' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    await waitFor(() => expect(boardFetches()).toBe(2))
  })

  // A create changes which issues the board query matches, so the board is
  // stale for the same reason even though no existing card changed.
  it('refetches the board after an issue is created', async () => {
    server.use(http.post('/v1/issues', () =>
      HttpResponse.json({ ok: true, data: { issue: { id: 'td-new' } } }, { status: 201 })))
    const wrap = await withMountedBoard()

    const { result } = renderHook(() => useCreateIssue(), { wrapper: wrap })
    result.current.mutate({ title: 'A new issue with a sufficiently long title' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    await waitFor(() => expect(boardFetches()).toBe(2))
  })
})
