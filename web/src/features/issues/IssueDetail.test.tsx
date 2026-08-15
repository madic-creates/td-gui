import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
  comments: [{
    id: 'cm-1f0a2b3c', issue_id: 'td-6a0883', session_id: 'ses_d87edf',
    text: 'The handoff panel should collapse past ten items per group.',
    created_at: '2026-08-14T15:04:10+02:00',
  }],
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
    // Close takes an optional reason, so it confirms through the form.
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm close' }))
    expect(await screen.findByText(rejection)).toBeInTheDocument()
  })

  // session_id and created_at already arrive from td but were previously
  // dropped. The id is shortened by stripping td's constant `ses_` prefix.
  it('shows a shortened session id on each comment', async () => {
    server.use(http.get('/v1/issues/td-6a0883', () =>
      HttpResponse.json({ ok: true, data: detail })))

    renderDetail()
    expect(await screen.findByText('session d87e')).toBeInTheDocument()
    expect(screen.getByText(/handoff panel should collapse/)).toBeInTheDocument()
  })

  it('deletes the issue after a confirmation and leaves the detail view', async () => {
    let deleted = false
    server.use(
      http.get('/v1/issues/td-6a0883', () => HttpResponse.json({ ok: true, data: detail })),
      http.delete('/v1/issues/td-6a0883', () => {
        deleted = true
        return HttpResponse.json({ ok: true, data: { deleted: true } })
      }),
      http.get('/v1/issues', () => HttpResponse.json({
        ok: true, data: { issues: [], limit: 50, offset: 0, total: 0, has_more: false },
      })),
    )
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(deleted).toBe(true))
  })

  it('sets focus and acknowledges the request without claiming to read it', async () => {
    let body: unknown
    server.use(
      http.get('/v1/issues/td-6a0883', () => HttpResponse.json({ ok: true, data: detail })),
      http.put('/v1/focus', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ ok: true, data: { focused_issue_id: 'td-6a0883' } })
      }),
    )
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: 'Focus' }))

    await waitFor(() => expect(body).toEqual({ issue_id: 'td-6a0883' }))
    expect(await screen.findByText('focus set')).toBeInTheDocument()
  })

  it('opens the edit form seeded with the current values', async () => {
    server.use(http.get('/v1/issues/td-6a0883', () => HttpResponse.json({ ok: true, data: detail })))
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))

    expect(screen.getByLabelText('Title')).toHaveValue('Probe issue for API shape')
  })
})
