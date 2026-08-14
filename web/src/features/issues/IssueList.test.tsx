import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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

  // Priority order and title order deliberately DISAGREE inside the `open`
  // group: td-open-a is the higher priority but sorts last by title. If they
  // agreed, the sort-by-title test below would pass without the click doing
  // anything at all.
  const mixed = [
    makeIssue({ id: 'td-open-a', status: 'open', priority: 'P0', title: 'Zebra' }),
    makeIssue({ id: 'td-prog', status: 'in_progress', priority: 'P2', title: 'Middle' }),
    makeIssue({ id: 'td-open-b', status: 'open', priority: 'P3', title: 'Alpha' }),
  ]

  function serveMixed() {
    server.use(http.get('/v1/issues', () =>
      HttpResponse.json({
        ok: true,
        data: { issues: mixed, limit: 500, offset: 0, total: 3, has_more: false },
      })))
  }

  /** Row ids in rendered order — the check that grouping actually reordered. */
  function renderedIds() {
    return screen.getAllByText(/^td-/).map(el => el.textContent)
  }

  it('splits the list into status groups with counts', async () => {
    serveMixed()
    renderList()
    // Queried by region rather than plain text: the status filter's own
    // checkboxes are labelled with these same words ("open", "in_progress", …)
    // and are present from the very first render, so a bare findByText would
    // resolve against the filter before the data — and thus the group
    // sections — ever arrive. The group's <section aria-label> gives each
    // group an unambiguous accessible name to query instead.
    expect(await screen.findByRole('region', { name: 'in_progress' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'open' })).toBeInTheDocument()
    // in_progress comes first even though td-open-a (P0) outranks td-prog (P2):
    // the group order wins over the sort.
    expect(renderedIds()).toEqual(['td-prog', 'td-open-a', 'td-open-b'])
  })

  it('sorts within a group and never moves a row across a group boundary', async () => {
    const user = userEvent.setup()
    serveMixed()
    renderList()
    // See the rationale above: query by region, not by the collides-with-the-
    // filter plain text.
    await screen.findByRole('region', { name: 'in_progress' })

    await user.click(screen.getByRole('button', { name: 'Sort by title, ascending' }))

    // Alpha < Zebra flips the open group; td-prog stays alone on top.
    expect(renderedIds()).toEqual(['td-prog', 'td-open-b', 'td-open-a'])

    await user.click(screen.getByRole('button', { name: /^Sorted by title/ }))
    expect(renderedIds()).toEqual(['td-prog', 'td-open-a', 'td-open-b'])
  })

  it('shows when each issue was last updated', async () => {
    server.use(http.get('/v1/issues', () =>
      HttpResponse.json({
        ok: true,
        data: {
          issues: [makeIssue({ id: 'td-1', updated_at: new Date().toISOString() })],
          limit: 500, offset: 0, total: 1, has_more: false,
        },
      })))

    renderList()
    expect(await screen.findByText('just now')).toBeInTheDocument()
  })
})
