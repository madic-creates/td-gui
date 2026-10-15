import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import SessionList from './SessionList'
import { makeSession } from './activity.fixture'
import type { Session } from '../../api/types'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderList(sessions: Session[]) {
  server.use(http.get('/v1/sessions', () =>
    HttpResponse.json({ ok: true, data: { current_session_id: 'ses_web', sessions } })))
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><SessionList /></MemoryRouter>
    </QueryClientProvider>,
  )
}

/** The labels of the rendered cards, in order. */
async function labels() {
  const list = await screen.findByRole('list', { name: 'Agent sessions' })
  return within(list).getAllByRole('listitem').map(li => li.querySelector('strong')?.textContent)
}

const many = (n: number) => Array.from({ length: n }, (_, i) => makeSession({
  id: `ses_${String(i).padStart(6, '0')}`,
  name: `s${i}`,
  // Older as i grows, so s0 is the most recent.
  last_activity: new Date(Date.UTC(2026, 9, 15, 12) - i * 60_000).toISOString(),
}))

describe('SessionList', () => {
  it('lists sessions newest first with their id, branch and last activity', async () => {
    renderList([
      makeSession({ id: 'ses_old111', name: 'old', branch: 'main', last_activity: '2026-10-01T00:00:00Z' }),
      makeSession({ id: 'ses_new222', name: 'new', branch: 'feat/x', last_activity: '2026-10-15T00:00:00Z' }),
    ])

    expect(await labels()).toEqual(['new', 'old'])
    expect(screen.getByText('ses_new222')).toBeInTheDocument()
    expect(screen.getByText('feat/x')).toBeInTheDocument()
  })

  it('shows the total in the heading', async () => {
    renderList(many(3))
    expect(await screen.findByRole('heading', { name: 'Agent sessions 3' })).toBeInTheDocument()
  })

  it('says that a timestamp is not a liveness check', async () => {
    renderList(many(1))
    expect(await screen.findByText('Last recorded activity, not process health.')).toBeInTheDocument()
  })

  it('shows the 20 most recent and offers the rest behind a button', async () => {
    renderList(many(25))

    const shown = await labels()
    expect(shown).toHaveLength(20)
    expect(shown[0]).toBe('s0')
    expect(shown[19]).toBe('s19')

    await userEvent.click(screen.getByRole('button', { name: 'Show all (25)' }))

    expect(await labels()).toHaveLength(25)
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument()
  })

  it('offers no button when everything already fits', async () => {
    renderList(many(20))
    expect(await labels()).toHaveLength(20)
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument()
  })

  it('says so when td has recorded no sessions', async () => {
    renderList([])
    expect(await screen.findByText('No agent sessions recorded.')).toBeInTheDocument()
  })

  it("shows td's error verbatim", async () => {
    server.use(http.get('/v1/sessions', () => HttpResponse.json(
      { ok: false, error: { code: 'internal', message: 'database is locked' } }, { status: 500 })))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}><MemoryRouter><SessionList /></MemoryRouter></QueryClientProvider>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('database is locked')
  })
})
