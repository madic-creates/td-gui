import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import {
  useDeleteIssue, useMoveCard, useRecordReview, useTransition, useUpdateIssue,
} from './mutations'
import { issueKeys } from './queries'

const ID = 'td-6a0883'
const REV = 'd400e3455ece'

const project = (capabilities: string[]) =>
  http.get('/v1/project', () => HttpResponse.json({ ok: true, data: { capabilities } }))

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, wrapper }
}

/** Records the If-Match header of every write to the issue. */
function captureWrites() {
  const seen: (string | null)[] = []
  const ok = ({ request }: { request: Request }) => {
    seen.push(request.headers.get('If-Match'))
    return HttpResponse.json({ ok: true, data: { issue: { id: ID, revision: 'next' } } })
  }
  server.use(
    http.patch(`/v1/issues/${ID}`, ok),
    http.delete(`/v1/issues/${ID}`, ok),
    http.post(`/v1/issues/${ID}/start`, ok),
    http.post(`/v1/issues/${ID}/reviews`, ok),
  )
  return seen
}

describe('If-Match on issue writes', () => {
  it('sends the revision, quoted, on every issue write when td reports issue_revisions', async () => {
    server.use(project(['issue_revisions', 'board_move']))
    const seen = captureWrites()
    const { wrapper } = setup()

    const update = renderHook(() => useUpdateIssue(ID), { wrapper }).result
    await update.current.mutateAsync({ patch: { title: 'A new title here' }, revision: REV })
    const transition = renderHook(() => useTransition(ID), { wrapper }).result
    await transition.current.mutateAsync({ action: 'start', revision: REV })
    const record = renderHook(() => useRecordReview(ID), { wrapper }).result
    await record.current.mutateAsync({ summary: 'fine', revision: REV })
    const remove = renderHook(() => useDeleteIssue(ID), { wrapper }).result
    await remove.current.mutateAsync(REV)

    expect(seen).toEqual(Array(4).fill(`"${REV}"`))
  })

  it('keeps the revision out of the request body', async () => {
    server.use(project(['issue_revisions']))
    let body: unknown
    server.use(http.post(`/v1/issues/${ID}/start`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ ok: true, data: {} })
    }))
    const { wrapper } = setup()
    const { result } = renderHook(() => useTransition(ID), { wrapper })

    await result.current.mutateAsync({ action: 'start', reason: 'go', revision: REV })

    expect(body).toEqual({ reason: 'go' })
  })

  it('sends no If-Match when td does not report issue_revisions', async () => {
    server.use(project(['board_move']))
    const seen = captureWrites()
    const { wrapper } = setup()
    const { result } = renderHook(() => useUpdateIssue(ID), { wrapper })

    await result.current.mutateAsync({ patch: { title: 'A new title here' }, revision: REV })

    expect(seen).toEqual([null])
  })

  // td before v0.66.0 has no /v1/project at all. Writes must still work.
  it('sends no If-Match when td has no project route', async () => {
    server.use(http.get('/v1/project', () => HttpResponse.json(
      { ok: false, error: { code: 'not_found', message: 'not found' } }, { status: 404 })))
    const seen = captureWrites()
    const { wrapper } = setup()
    const { result } = renderHook(() => useTransition(ID), { wrapper })

    await result.current.mutateAsync({ action: 'start', revision: REV })

    expect(seen).toEqual([null])
  })

  it('sends no If-Match when the caller knows no revision', async () => {
    server.use(project(['issue_revisions']))
    const seen = captureWrites()
    const { wrapper } = setup()
    const { result } = renderHook(() => useTransition(ID), { wrapper })

    await result.current.mutateAsync({ action: 'start' })

    expect(seen).toEqual([null])
  })

  it('asks td for its capabilities once, not once per write', async () => {
    let asked = 0
    server.use(http.get('/v1/project', () => {
      asked += 1
      return HttpResponse.json({ ok: true, data: { capabilities: ['issue_revisions'] } })
    }))
    captureWrites()
    const { wrapper } = setup()
    const { result } = renderHook(() => useTransition(ID), { wrapper })

    await result.current.mutateAsync({ action: 'start', revision: REV })
    await result.current.mutateAsync({ action: 'start', revision: REV })

    expect(asked).toBe(1)
  })

  // board_move and issue_revisions are read from the same answer: a board
  // move followed by an issue write asks td once, not once per feature.
  it('shares one capability read between a board move and an issue write', async () => {
    let asked = 0
    server.use(
      http.get('/v1/project', () => {
        asked += 1
        return HttpResponse.json({ ok: true, data: { capabilities: ['issue_revisions', 'board_move'] } })
      }),
      http.post('/v1/boards/:id/move', () => HttpResponse.json({ ok: true, data: { positioned: true } })),
    )
    const seen = captureWrites()
    const { wrapper } = setup()

    const move = renderHook(() => useMoveCard('bd-1', false), { wrapper }).result
    await move.current.mutateAsync({ issueId: ID, beforeId: 'td-c3d4', slot: 1 })
    const transition = renderHook(() => useTransition(ID), { wrapper }).result
    await transition.current.mutateAsync({ action: 'start', revision: REV })

    expect(asked).toBe(1)
    expect(seen).toEqual([`"${REV}"`])
  })

  it('refetches the issue when td answers 409, and keeps td\'s message', async () => {
    server.use(
      project(['issue_revisions']),
      http.post(`/v1/issues/${ID}/start`, () => HttpResponse.json({
        ok: false,
        error: { code: 'conflict', message: 'This task changed since you opened it.' },
      }, { status: 409 })),
    )
    const { qc, wrapper } = setup()
    qc.setQueryData(issueKeys.detail(ID), { issue: { id: ID, revision: REV } })
    const { result } = renderHook(() => useTransition(ID), { wrapper })

    await expect(result.current.mutateAsync({ action: 'start', revision: REV }))
      .rejects.toMatchObject({ code: 'conflict', status: 409, message: 'This task changed since you opened it.' })

    await waitFor(() =>
      expect(qc.getQueryState(issueKeys.detail(ID))?.isInvalidated).toBe(true))
  })
})
