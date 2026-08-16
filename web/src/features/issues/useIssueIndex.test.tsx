import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { useIssueIndex } from './useIssueIndex'
import { makeIssue } from './issue.fixture'
import { FETCH_LIMIT, useIssues } from '../../api/queries'
import type { Issue } from '../../api/types'
import type { ReactNode } from 'react'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

/**
 * Records the status filter of every list request, and answers each from
 * `byStatus` — keyed by the filter the request carried, joined on ','. The
 * hook fires two requests that must not be answered alike, and asserting on
 * the last one to land would be a race.
 */
function stubList(byStatus: Record<string, Issue[]>): string[][] {
  const seen: string[][] = []
  server.use(http.get('/v1/issues', ({ request }) => {
    const status = new URL(request.url).searchParams.getAll('status')
    seen.push(status)
    const issues = byStatus[status.join(',')] ?? []
    return HttpResponse.json({
      ok: true,
      data: { issues, limit: 1000, offset: 0, total: issues.length, has_more: false },
    })
  }))
  return seen
}

describe('useIssueIndex', () => {
  it('indexes the whole unfiltered list by id', async () => {
    const issues = [makeIssue({ id: 'td-aaa' }), makeIssue({ id: 'td-bbb' })]
    const seen = stubList({ '': issues })

    const { result } = renderHook(() => useIssueIndex(), { wrapper })

    await waitFor(() => expect(result.current.index.size).toBe(2))
    expect(result.current.index.get('td-aaa')?.id).toBe('td-aaa')
    expect(result.current.issues).toHaveLength(2)
    // Unfiltered: a status filter would hide referenced issues from the index.
    expect(seen).toContainEqual([])
  })

  // td serve reads an absent status filter as "everything except closed", so
  // the unfiltered list alone can never offer a closed issue as a dependency,
  // nor title one that is already a blocker.
  it('also fetches the closed issues the unfiltered list omits', async () => {
    const open = makeIssue({ id: 'td-open' })
    const done = makeIssue({ id: 'td-done', status: 'closed' })
    const seen = stubList({ '': [open], closed: [done] })

    const { result } = renderHook(() => useIssueIndex(), { wrapper })

    await waitFor(() => expect(result.current.index.size).toBe(2))
    expect(result.current.index.get('td-done')?.status).toBe('closed')
    expect(seen).toContainEqual(['closed'])
    // Open first: candidatesFor keeps the caller's order within each group,
    // and closed issues are the ones a reader reaches for last.
    expect(result.current.issues.map(issue => issue.id)).toEqual(['td-open', 'td-done'])
  })

  // Both requests ask for `limit`, and each carries td's whole 1000-issue page
  // for its own half — one shared cap would let closed issues, which td ranks
  // by priority alongside open ones, crowd open work out of the index.
  it('asks for a full page on both requests', async () => {
    let limits: string[] = []
    server.use(http.get('/v1/issues', ({ request }) => {
      limits = [...limits, new URL(request.url).searchParams.get('limit') ?? '']
      return HttpResponse.json({
        ok: true, data: { issues: [], limit: 1000, offset: 0, total: 0, has_more: false },
      })
    }))

    renderHook(() => useIssueIndex(), { wrapper })

    await waitFor(() => expect(limits).toHaveLength(2))
    expect(limits).toEqual([String(FETCH_LIMIT), String(FETCH_LIMIT)])
  })

  // Should td ever return closed rows on the unfiltered list too, the overlap
  // must not double every such issue into the picker's candidate list.
  it('indexes an issue returned by both requests once', async () => {
    const done = makeIssue({ id: 'td-done', status: 'closed' })
    stubList({ '': [makeIssue({ id: 'td-open' }), done], closed: [done] })

    const { result } = renderHook(() => useIssueIndex(), { wrapper })

    await waitFor(() => expect(result.current.index.size).toBe(2))
    expect(result.current.issues.map(issue => issue.id)).toEqual(['td-open', 'td-done'])
  })

  // The two requests are independent, and the closed half is the expendable
  // one: losing it must not blank the titles the detail view already had.
  it('keeps the open issues when the closed request fails', async () => {
    server.use(http.get('/v1/issues', ({ request }) => {
      if (new URL(request.url).searchParams.getAll('status').includes('closed')) {
        return HttpResponse.json(
          { ok: false, error: { code: 'internal', message: 'boom' } }, { status: 500 })
      }
      return HttpResponse.json({
        ok: true,
        data: {
          issues: [makeIssue({ id: 'td-open' })],
          limit: 1000, offset: 0, total: 1, has_more: false,
        },
      })
    }))

    const { result } = renderHook(() => useIssueIndex(), { wrapper })

    await waitFor(() => expect(result.current.index.size).toBe(1))
    expect(result.current.index.get('td-open')?.id).toBe('td-open')
  })

  // The index is enrichment. Callers render bare ids until it lands, so it
  // must report an empty index rather than throw or suspend. The handler
  // below returns real issues so the synchronous first-render assertion
  // (before the response resolves) actually distinguishes "still loading"
  // from "loaded and empty" — a handler returning zero issues would pass
  // either way.
  it('reports an empty index while the list is still loading', () => {
    const issues = [makeIssue({ id: 'td-aaa' }), makeIssue({ id: 'td-bbb' })]
    server.use(http.get('/v1/issues', () => HttpResponse.json({
      ok: true, data: { issues, limit: 1000, offset: 0, total: 2, has_more: false },
    })))

    const { result } = renderHook(() => useIssueIndex(), { wrapper })
    expect(result.current.index.size).toBe(0)
    expect(result.current.issues).toEqual([])
  })

  it('reports an empty index when the list request fails', async () => {
    server.use(http.get('/v1/issues', () => HttpResponse.json(
      { ok: false, error: { code: 'internal', message: 'boom' } }, { status: 500 })))

    // useIssueIndex only reads `data` off the query, so a component that
    // reads nothing else never re-renders on a pending->error transition
    // (react-query only notifies a component of fields it actually reads).
    // Reading `status` alongside the hook, off the same query key, forces a
    // render once the request genuinely fails, so the assertions below are
    // checked against the failed state rather than replaying the initial
    // pending render. This also means a hook that threw on error would fail
    // this test: the throw would happen during that render and propagate out
    // of renderHook, since nothing here catches it.
    const { result } = renderHook(() => {
      const { status } = useIssues({ limit: FETCH_LIMIT })
      return { status, ...useIssueIndex() }
    }, { wrapper })

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.index.size).toBe(0)
    expect(result.current.issues).toEqual([])
  })
})
