import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  it('renders no sort control when the list is empty — there is nothing to sort', async () => {
    server.use(http.get('/v1/issues', () =>
      HttpResponse.json({
        ok: true,
        data: { issues: [], limit: 50, offset: 0, total: 0, has_more: false },
      })))

    renderList()
    await screen.findByText(/no issues/i)
    expect(screen.queryByRole('button', { name: /^Sort by/ })).not.toBeInTheDocument()
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
        data: { issues: [], limit: 1000, offset: 0, total: 0, has_more: false },
      })
    }))

    renderList()
    await screen.findByText(/no issues/i)
    expect(seen?.searchParams.get('limit')).toBe('1000')
    expect(seen?.searchParams.has('offset')).toBe(false)
  })

  it('says so when the result set is capped, instead of showing a partial picture quietly', async () => {
    server.use(http.get('/v1/issues', () =>
      HttpResponse.json({
        ok: true,
        data: {
          issues: [makeIssue({ id: 'td-1' })],
          limit: 1000, offset: 0, total: 812, has_more: true,
        },
      })))

    renderList()
    expect(await screen.findByText(/Showing 1 of 812/)).toBeInTheDocument()

    // The group beneath the notice still renders, and its count carries the
    // same caveat: it is a lower bound, not the true size of that status.
    const open = screen.getByRole('region', { name: 'open' })
    expect(within(open).getByText('td-1')).toBeInTheDocument()
    expect(within(open).getByText('1+')).toBeInTheDocument()
    expect(within(open).getByLabelText('1 or more issues')).toBeInTheDocument()
  })

  it('stays quiet when the whole list fits', async () => {
    server.use(http.get('/v1/issues', () =>
      HttpResponse.json({
        ok: true,
        data: {
          issues: [makeIssue({ id: 'td-1' })],
          limit: 1000, offset: 0, total: 1, has_more: false,
        },
      })))

    renderList()
    await screen.findByText('td-1')
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument()

    // No caveat on the group count either: the whole result set is present,
    // so the bare number is exact.
    const open = screen.getByRole('region', { name: 'open' })
    expect(within(open).getByText('1')).toBeInTheDocument()
    expect(within(open).queryByText('1+')).not.toBeInTheDocument()
    expect(within(open).getByLabelText('1 issues')).toBeInTheDocument()
  })

  // Three open issues whose priority order is NOT the reverse of their title
  // order — with only two, title-descending and priority-ascending coincide and
  // the direction toggle goes untested.
  const mixed = [
    makeIssue({ id: 'td-open-a', status: 'open', priority: 'P0', title: 'Zebra' }),
    makeIssue({ id: 'td-prog', status: 'in_progress', priority: 'P2', title: 'Middle' }),
    makeIssue({ id: 'td-open-b', status: 'open', priority: 'P1', title: 'Alpha' }),
    makeIssue({ id: 'td-open-c', status: 'open', priority: 'P3', title: 'Mango' }),
  ]

  function serveMixed() {
    server.use(http.get('/v1/issues', () =>
      HttpResponse.json({
        ok: true,
        data: { issues: mixed, limit: 1000, offset: 0, total: 4, has_more: false },
      })))
  }

  /** Row ids in rendered order — the check that grouping actually reordered. */
  function renderedIds() {
    return screen.getAllByText(/^td-/).map(el => el.textContent)
  }

  it('splits the list into status groups with counts', async () => {
    serveMixed()
    renderList()

    const progress = await screen.findByRole('region', { name: 'in_progress' })
    const open = screen.getByRole('region', { name: 'open' })
    // The count is per group, not the size of the whole response.
    expect(within(progress).getByText('1')).toBeInTheDocument()
    expect(within(open).getByText('3')).toBeInTheDocument()

    // in_progress leads even though td-open-a is P0, the highest priority in the
    // list: the grouping outranks the sort.
    expect(renderedIds()).toEqual(['td-prog', 'td-open-a', 'td-open-b', 'td-open-c'])
  })

  it('sorts within a group and never moves a row across a group boundary', async () => {
    const user = userEvent.setup()
    serveMixed()
    renderList()
    await screen.findByRole('region', { name: 'in_progress' })

    await user.click(screen.getByRole('button', { name: 'Sort by title, ascending' }))
    // Alpha, Mango, Zebra — and td-prog stays alone in its own group on top.
    expect(renderedIds()).toEqual(['td-prog', 'td-open-b', 'td-open-c', 'td-open-a'])

    await user.click(screen.getByRole('button', { name: /^Sorted by title/ }))
    // Zebra, Mango, Alpha — deliberately NOT the same as the priority order
    // (td-open-a, td-open-b, td-open-c), so a reset to the default fails here.
    expect(renderedIds()).toEqual(['td-prog', 'td-open-a', 'td-open-c', 'td-open-b'])
  })

  it('shows when each issue was last updated', async () => {
    server.use(http.get('/v1/issues', () =>
      HttpResponse.json({
        ok: true,
        data: {
          issues: [makeIssue({ id: 'td-1', updated_at: new Date().toISOString() })],
          limit: 1000, offset: 0, total: 1, has_more: false,
        },
      })))

    renderList()
    expect(await screen.findByText('just now')).toBeInTheDocument()
  })
})
