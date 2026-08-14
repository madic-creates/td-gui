import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import IssueList from './IssueList'
import { makeIssue } from './issue.fixture'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><IssueList /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('IssueList', () => {
  it('renders issues from the list envelope', async () => {
    server.use(http.get('/v1/issues', () =>
      HttpResponse.json({
        ok: true,
        data: {
          issues: [makeIssue({ id: 'td-6a0883', title: 'Probe issue for API shape' })],
          limit: 50, offset: 0, total: 1, has_more: false,
        },
      })))

    renderList()
    expect(await screen.findByText('Probe issue for API shape')).toBeInTheDocument()
    expect(screen.getByText('td-6a0883')).toBeInTheDocument()
  })

  it('shows an empty state rather than a blank page', async () => {
    server.use(http.get('/v1/issues', () =>
      HttpResponse.json({
        ok: true,
        data: { issues: [], limit: 50, offset: 0, total: 0, has_more: false },
      })))

    renderList()
    expect(await screen.findByText(/no issues/i)).toBeInTheDocument()
  })

  it('surfaces the server error message on failure', async () => {
    server.use(http.get('/v1/issues', () =>
      HttpResponse.json({
        ok: false,
        error: { code: 'internal', message: 'database is locked' },
      }, { status: 500 })))

    renderList()
    expect(await screen.findByText(/database is locked/)).toBeInTheDocument()
  })

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
})
