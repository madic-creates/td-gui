import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { useBoard, useBoards } from './boards'
import {
  useCreateBoard, useCreateIssue, useClearCardPosition, useSetCardPosition, useTransition,
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
