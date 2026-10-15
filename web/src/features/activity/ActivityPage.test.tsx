import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import ActivityPage from './ActivityPage'
import { makeActivity, makeSession } from './activity.fixture'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const failing = (message: string) => () =>
  HttpResponse.json({ ok: false, error: { code: 'internal', message } }, { status: 500 })

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/activity']}><ActivityPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ActivityPage', () => {
  it('shows both columns under one heading', async () => {
    server.use(
      http.get('/v1/monitor', () => HttpResponse.json({ ok: true, data: { monitor: { activity: [makeActivity({ message: 'started work' })] } } })),
      http.get('/v1/sessions', () => HttpResponse.json({ ok: true, data: { current_session_id: 'x', sessions: [makeSession({ name: 'planner' })] } })),
    )
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Activity' })).toBeInTheDocument()
    expect(await screen.findByText('started work')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Agent sessions' })).toHaveTextContent('planner')
  })

  it('keeps the feed when the sessions request fails', async () => {
    server.use(
      http.get('/v1/monitor', () => HttpResponse.json({ ok: true, data: { monitor: { activity: [makeActivity({ session_id: 'ses_d87edf', message: 'started work' })] } } })),
      http.get('/v1/sessions', failing('sessions are broken')),
    )
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('sessions are broken')
    expect(await screen.findByText('started work')).toBeInTheDocument()
    expect(screen.getByText('d87e')).toBeInTheDocument()
  })

  it('keeps the sessions when the monitor request fails', async () => {
    server.use(
      http.get('/v1/monitor', failing('monitor is broken')),
      http.get('/v1/sessions', () => HttpResponse.json({ ok: true, data: { current_session_id: 'x', sessions: [makeSession({ name: 'planner' })] } })),
    )
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('monitor is broken')
    expect(await screen.findByText('planner')).toBeInTheDocument()
  })
})
