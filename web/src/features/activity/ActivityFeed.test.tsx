import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import ActivityFeed from './ActivityFeed'
import { makeActivity, makeSession } from './activity.fixture'
import type { ActivityItem, Session } from '../../api/types'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderFeed(activity: ActivityItem[], sessions: Session[] = []) {
  server.use(
    http.get('/v1/monitor', () => HttpResponse.json({ ok: true, data: { monitor: { activity } } })),
    http.get('/v1/sessions', () =>
      HttpResponse.json({ ok: true, data: { current_session_id: 'ses_web', sessions } })),
  )
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><ActivityFeed /></MemoryRouter>
    </QueryClientProvider>,
  )
}

const entries = async () =>
  within(await screen.findByRole('list', { name: 'Recent activity' })).getAllByRole('listitem')

describe('ActivityFeed', () => {
  it("shows td's message verbatim and links the issue td named", async () => {
    renderFeed([makeActivity({ message: 'submitted for review', issue_id: 'td-6f5475', issue_title: 'Require the same Go version' })])

    expect(await screen.findByText('submitted for review')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Require the same Go version' }))
      .toHaveAttribute('href', '/issues/td-6f5475')
  })

  // td puts a log, handoff or file-link id in issue_id for these, and says so
  // by leaving issue_title empty. A link would lead to a 404.
  it.each([
    ['create', 'lg-540c0e41', 'created issue'],
    ['handoff', 'ho-3b2d54a5', 'handoff'],
    ['link_file', 'ifl_743118747f285583', 'linked file'],
  ])('does not link a %s entry, whose id is not an issue', async (action, id, message) => {
    renderFeed([makeActivity({ action, issue_id: id, issue_title: '', message })])

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('tags a log entry with its kind', async () => {
    renderFeed([makeActivity({ type: 'log', log_type: 'decision', message: 'Use JWT' })])
    const [entry] = await entries()
    expect(within(entry).getByText('decision')).toBeInTheDocument()
  })

  it('names the session that wrote each entry', async () => {
    renderFeed(
      [
        makeActivity({ session_id: 'ses_111111', message: 'one' }),
        makeActivity({ session_id: 'ses_d87edf', message: 'two' }),
        makeActivity({ session_id: '', message: 'three' }),
      ],
      [makeSession({ id: 'ses_111111', name: '', agent_type: 'claude-code_445451' })],
    )

    // The first byline resolves once /v1/sessions lands; findByText waits for it.
    expect(await screen.findByText('claude-code_445451')).toBeInTheDocument()
    const [, second, third] = await entries()
    expect(within(second).getByText('d87e')).toBeInTheDocument()
    expect(within(third).getByText('unknown session')).toBeInTheDocument()
  })

  it('keeps td order, newest first, as td sent it', async () => {
    renderFeed([makeActivity({ message: 'newer' }), makeActivity({ message: 'older' })])
    const items = await entries()
    expect(items.map(li => li.querySelector('p')?.textContent)).toEqual(['newer', 'older'])
  })

  it('wraps a long multi-line message inside the column', async () => {
    renderFeed([makeActivity({ message: 'line one\nline two' })])
    const text = await screen.findByText(/line one/)
    expect(text).toHaveClass('whitespace-pre-line', 'break-words')
  })

  it('offers the exact time on hover', async () => {
    renderFeed([makeActivity({ timestamp: '2026-10-15T12:00:00Z' })])
    const [entry] = await entries()
    expect(within(entry).getByTitle('2026-10-15T12:00:00Z')).toBeInTheDocument()
  })

  it('says so when td has nothing to show', async () => {
    renderFeed([])
    expect(await screen.findByText('No recent activity.')).toBeInTheDocument()
  })

  it("shows td's error verbatim", async () => {
    server.use(
      http.get('/v1/monitor', () => HttpResponse.json(
        { ok: false, error: { code: 'internal', message: 'database is locked' } }, { status: 500 })),
      http.get('/v1/sessions', () =>
        HttpResponse.json({ ok: true, data: { current_session_id: 'ses_web', sessions: [] } })),
    )
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}><MemoryRouter><ActivityFeed /></MemoryRouter></QueryClientProvider>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('database is locked')
  })
})
