import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import IssueList from './IssueList'

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

const issue = {
  id: 'td-6a0883', title: 'Probe issue for API shape', description: '',
  status: 'open', type: 'feature', priority: 'P1', points: 0, labels: [],
  parent_id: null, acceptance: '', sprint: '', implementer_session: null,
  creator_session: 'ses_d87edf', reviewer_session: null,
  review_requested_by_session: null, closed_by_session: null,
  created_at: '2026-08-14T15:01:46+02:00', updated_at: '2026-08-14T15:01:46+02:00',
  reviewed_at: null, closed_at: null, deleted_at: null, minor: false,
  created_branch: null, defer_until: null, due_date: null, defer_count: 0,
}

describe('IssueList', () => {
  it('renders issues from the list envelope', async () => {
    server.use(http.get('/v1/issues', () =>
      HttpResponse.json({
        ok: true,
        data: { issues: [issue], limit: 50, offset: 0, total: 1, has_more: false },
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
})
