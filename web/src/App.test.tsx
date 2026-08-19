import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import App from './App'

// Minimal EventSource stand-in: jsdom does not implement one, and App renders
// useLiveUpdates() unconditionally regardless of which route matches.
class FakeEventSource {
  addEventListener() {}
  close() {}
}

beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource))
afterEach(() => vi.unstubAllGlobals())

function renderApp(path: string) {
  const qc = new QueryClient()
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
})
