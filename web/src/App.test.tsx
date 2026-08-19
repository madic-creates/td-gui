import { describe, expect, it, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import App from './App'
import { makeIssue } from './features/issues/issue.fixture'

// Minimal EventSource stand-in: jsdom does not implement one, and App renders
// useLiveUpdates() unconditionally regardless of which route matches.
class FakeEventSource {
  addEventListener() {}
  close() {}
}

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource))
afterEach(() => vi.unstubAllGlobals())

function renderApp(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('App routing', () => {
  it('shows a not-found page instead of a blank one for an unmatched path', () => {
    renderApp('/typo/does-not-exist')
    expect(screen.getByText('Page not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'back to list' })).toHaveAttribute('href', '/')
  })

  // Reachable by URL, not only through the header — the whole reason About is
  // a route rather than a popover is that it can be linked to and reloaded.
  it('matches /about rather than falling through to not-found', () => {
    renderApp('/about')
    expect(screen.queryByText('Page not found')).not.toBeInTheDocument()
  })

  // The bug this replaced, end to end: the filter was component state, so
  // opening an issue threw it away and coming back showed the whole list.
  it('still has the filter after opening an issue and coming back', async () => {
    const user = userEvent.setup()
    const flying = makeIssue({ id: 'td-prog', status: 'in_progress', title: 'A bug in flight' })
    server.use(
      // td filters server-side, so the chip has to reach the request for the
      // list to narrow — which is the point of the round trip being tested.
      http.get('/v1/issues', ({ request }) => {
        const wanted = new URL(request.url).searchParams.getAll('status')
        const all = [flying, makeIssue({ id: 'td-open', status: 'open', title: 'An open one' })]
        const issues = wanted.length ? all.filter(i => wanted.includes(i.status)) : all
        return HttpResponse.json({
          ok: true,
          data: { issues, limit: 1000, offset: 0, total: issues.length, has_more: false },
        })
      }),
      http.get('/v1/issues/td-prog', () => HttpResponse.json({
        ok: true,
        data: {
          issue: { ...flying, available_transitions: [] },
          logs: [], comments: [], dependencies: [], blocked_by: [],
          latest_handoff: null, reviews: [],
        },
      })),
      http.get('/v1/labels', () => HttpResponse.json({
        ok: true, data: { default_workflow: 'standard', labels: [] },
      })),
    )

    renderApp('/')
    await screen.findByText('A bug in flight')
    await user.click(screen.getByRole('checkbox', { name: 'in_progress' }))
    await waitFor(() =>
      expect(screen.queryByText('An open one')).not.toBeInTheDocument())

    await user.click(screen.getByText('A bug in flight'))
    await screen.findByRole('link', { name: '← back to list' })
    await user.click(screen.getByRole('link', { name: '← back to list' }))

    expect(await screen.findByText('A bug in flight')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'in_progress' })).toBeChecked()
    expect(screen.queryByText('An open one')).not.toBeInTheDocument()
  })
})
