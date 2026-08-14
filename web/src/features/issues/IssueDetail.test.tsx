import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import IssueDetail from './IssueDetail'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const detail = {
  issue: {
    id: 'td-6a0883', title: 'Probe issue for API shape', description: 'A description',
    status: 'in_progress', type: 'feature', priority: 'P1', points: 0, labels: [],
    parent_id: null, acceptance: '', sprint: '', implementer_session: 'ses_d87edf',
    creator_session: 'ses_d87edf', reviewer_session: null,
    review_requested_by_session: null, closed_by_session: null,
    created_at: '2026-08-14T15:01:46+02:00', updated_at: '2026-08-14T15:04:10+02:00',
    reviewed_at: null, closed_at: null, deleted_at: null, minor: false,
    created_branch: null, defer_until: null, due_date: null, defer_count: 0,
    available_transitions: ['review', 'block', 'close'],
  },
  logs: [{
    id: 'lg-a9e03af6', issue_id: 'td-6a0883', session_id: 'ses_d87edf',
    work_session_id: '', message: 'Started work', type: 'progress',
    timestamp: '2026-08-14T15:04:10+02:00',
  }],
  comments: [],
  dependencies: [],
  blocked_by: [],
  latest_handoff: {
    id: 'ho-22111a5e', issue_id: 'td-6a0883', session_id: 'ses_d87edf',
    done: ['done bits'], remaining: ['remaining bits'],
    decisions: ['a decision'], uncertain: ['an open question'],
    timestamp: '2026-08-14T15:04:10+02:00',
  },
}

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/issues/td-6a0883']}>
        <Routes><Route path="/issues/:id" element={<IssueDetail />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('IssueDetail', () => {
  it('reads the issue from the nested `issue` key', async () => {
    server.use(http.get('/v1/issues/td-6a0883', () =>
      HttpResponse.json({ ok: true, data: detail })))

    renderDetail()
    expect(await screen.findByText('Probe issue for API shape')).toBeInTheDocument()
    expect(screen.getByText('A description')).toBeInTheDocument()
    expect(screen.getByText('Started work')).toBeInTheDocument()
    expect(screen.getByText('done bits')).toBeInTheDocument()
  })

  // The UI must render exactly what td permits, never a status-based guess.
  it('renders only the available transitions', async () => {
    server.use(http.get('/v1/issues/td-6a0883', () =>
      HttpResponse.json({ ok: true, data: detail })))

    renderDetail()
    expect(await screen.findByRole('button', { name: 'Request review' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Block' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('shows no transition buttons when the field is absent', async () => {
    const issue = { ...detail.issue }
    delete (issue as Partial<typeof detail.issue>).available_transitions
    server.use(http.get('/v1/issues/td-6a0883', () =>
      HttpResponse.json({ ok: true, data: { ...detail, issue } })))

    renderDetail()
    await screen.findByText('Probe issue for API shape')
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })

  // The load-bearing error case: td's policy wording must reach the user.
  it("shows td's policy rejection verbatim when a transition is refused", async () => {
    const rejection = 'you implemented this issue, so you cannot approve it'
    server.use(
      http.get('/v1/issues/td-6a0883', () => HttpResponse.json({ ok: true, data: detail })),
      http.post('/v1/issues/td-6a0883/close', () =>
        HttpResponse.json({ ok: false, error: { code: 'forbidden', message: rejection } },
          { status: 403 })),
    )

    renderDetail()
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }))
    expect(await screen.findByText(rejection)).toBeInTheDocument()
  })
})
