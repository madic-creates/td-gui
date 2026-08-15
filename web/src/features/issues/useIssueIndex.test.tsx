import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { useIssueIndex } from './useIssueIndex'
import { makeIssue } from './issue.fixture'
import type { ReactNode } from 'react'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useIssueIndex', () => {
  it('indexes the whole unfiltered list by id', async () => {
    const issues = [makeIssue({ id: 'td-aaa' }), makeIssue({ id: 'td-bbb' })]
    let seen: URL | undefined
    server.use(http.get('/v1/issues', ({ request }) => {
      seen = new URL(request.url)
      return HttpResponse.json({
        ok: true,
        data: { issues, limit: 1000, offset: 0, total: 2, has_more: false },
      })
    }))

    const { result } = renderHook(() => useIssueIndex(), { wrapper })

    await waitFor(() => expect(result.current.index.size).toBe(2))
    expect(result.current.index.get('td-aaa')?.id).toBe('td-aaa')
    expect(result.current.issues).toHaveLength(2)
    expect(seen?.searchParams.get('limit')).toBe('1000')
    // Unfiltered: a status filter would hide referenced issues from the index.
    expect(seen?.searchParams.getAll('status')).toEqual([])
  })

  // The index is enrichment. Callers render bare ids until it lands, so it
  // must report an empty index rather than throw or suspend.
  it('reports an empty index while the list is still loading', () => {
    server.use(http.get('/v1/issues', () => HttpResponse.json({
      ok: true, data: { issues: [], limit: 1000, offset: 0, total: 0, has_more: false },
    })))

    const { result } = renderHook(() => useIssueIndex(), { wrapper })
    expect(result.current.index.size).toBe(0)
    expect(result.current.issues).toEqual([])
  })

  it('reports an empty index when the list request fails', async () => {
    server.use(http.get('/v1/issues', () => HttpResponse.json(
      { ok: false, error: { code: 'internal', message: 'boom' } }, { status: 500 })))

    const { result } = renderHook(() => useIssueIndex(), { wrapper })

    await waitFor(() => expect(result.current.index.size).toBe(0))
    expect(result.current.issues).toEqual([])
  })
})
