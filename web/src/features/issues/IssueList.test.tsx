import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, MemoryRouter, RouterProvider, useLocation } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import IssueList from './IssueList'
import { makeIssue } from './issue.fixture'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

/** The list's own query string, so a test can read what it wrote. */
function CurrentUrl() {
  return <span data-testid="url">{useLocation().search}</span>
}

const url = () => screen.getByTestId('url').textContent

function renderList(entry = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <IssueList />
        <CurrentUrl />
      </MemoryRouter>
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

  describe('TDQ mode', () => {
    const indexed = [
      makeIssue({ id: 'td-bug', status: 'open', type: 'bug', title: 'A real bug' }),
      makeIssue({ id: 'td-prog', status: 'in_progress', type: 'bug', title: 'A bug in flight' }),
      makeIssue({ id: 'td-chore', status: 'open', type: 'chore', title: 'A chore' }),
    ]

    /** Serves the two halves of the index: everything open, and the closed. */
    function serveIndex(closed: ReturnType<typeof makeIssue>[] = []) {
      server.use(http.get('/v1/issues', ({ request }) => {
        const isClosed = new URL(request.url).searchParams.get('status') === 'closed'
        const issues = isClosed ? closed : indexed
        return HttpResponse.json({
          ok: true,
          data: { issues, limit: 1000, offset: 0, total: issues.length, has_more: false },
        })
      }))
    }

    function serveQuery(ids: string[]) {
      server.use(http.get('/gui/query', () =>
        HttpResponse.json({ ok: true, data: { ids } })))
    }

    async function runQuery(text: string) {
      const user = userEvent.setup()
      renderList()
      await screen.findByText('A real bug')
      await user.clear(screen.getByLabelText('Search'))
      await user.type(screen.getByLabelText('Search'), text + '{Enter}')
    }

    it('lists exactly the issues the query returned, in the usual groups', async () => {
      serveIndex()
      serveQuery(['td-bug', 'td-prog'])

      await runQuery('?type = bug')

      expect(await screen.findByText('A bug in flight')).toBeInTheDocument()
      expect(screen.getByText('A real bug')).toBeInTheDocument()
      // The chore is in the index but not in the result — the query defines
      // the set, not the index.
      expect(screen.queryByText('A chore')).not.toBeInTheDocument()
      expect(screen.getByRole('region', { name: 'in_progress' })).toBeInTheDocument()
    })

    it('sends the query to td-gui, not to td serve', async () => {
      let seen: URL | undefined
      serveIndex()
      server.use(http.get('/gui/query', ({ request }) => {
        seen = new URL(request.url)
        return HttpResponse.json({ ok: true, data: { ids: ['td-bug'] } })
      }))

      await runQuery('?type = bug AND priority <= P1')

      await screen.findByText('A real bug')
      expect(seen?.pathname).toBe('/gui/query')
      expect(seen?.searchParams.get('q')).toBe('type = bug AND priority <= P1')
    })

    it("shows td's own message for an invalid query, with a link to the grammar", async () => {
      serveIndex()
      server.use(http.get('/gui/query', () =>
        HttpResponse.json({
          ok: false,
          error: { code: 'invalid_query', message: 'parse error at line 1, column 9: expected value' },
        }, { status: 400 })))

      await runQuery('?status =')

      expect(await screen.findByText(/parse error at line 1, column 9/)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /query language/i })).toBeInTheDocument()
    })

    it('distinguishes a query that matched nothing from a filtered-out list', async () => {
      serveIndex()
      serveQuery([])

      await runQuery('?title ~ nothing')

      expect(await screen.findByText(/no issues match this query/i)).toBeInTheDocument()
      // The status-filter hint would send the reader to the wrong control.
      expect(screen.queryByText(/clearing the status filters/i)).not.toBeInTheDocument()
    })

    it('counts the results it could not resolve rather than dropping them quietly', async () => {
      serveIndex()
      serveQuery(['td-bug', 'td-beyond-the-cache', 'td-also-beyond'])

      await runQuery('?type = bug')

      expect(await screen.findByText(/Showing 1 of 3/)).toBeInTheDocument()
      expect(screen.getByText(/outside the loaded set/i)).toBeInTheDocument()
    })

    it('counts the rows it is sitting on, not the ones a chip just removed', async () => {
      // The notice bar renders directly above the rows. Counting the query's
      // resolved hits instead of the rendered ones put "Showing 2 of 3" over a
      // single row as soon as a chip narrowed the answer.
      const user = userEvent.setup()
      serveIndex()
      serveQuery(['td-bug', 'td-prog', 'td-beyond-the-cache'])

      await runQuery('?type = bug')
      expect(await screen.findByText(/Showing 2 of 3/)).toBeInTheDocument()

      await user.click(screen.getByRole('checkbox', { name: 'in_progress' }))

      expect(await screen.findByText(/Showing 1 of 3/)).toBeInTheDocument()
      expect(screen.getAllByRole('listitem')).toHaveLength(1)
      // The unresolvable hit is still reported: a chip narrows the answer, it
      // does not make the results outside the loaded set stop existing.
      expect(screen.getByText(/1 result is outside the loaded set/)).toBeInTheDocument()
    })

    it('lets the status chips trim a query result without re-running it', async () => {
      const user = userEvent.setup()
      let queryRuns = 0
      serveIndex()
      server.use(http.get('/gui/query', () => {
        queryRuns++
        return HttpResponse.json({ ok: true, data: { ids: ['td-bug', 'td-prog'] } })
      }))

      await runQuery('?type = bug')
      expect(await screen.findByText('A bug in flight')).toBeInTheDocument()

      await user.click(screen.getByRole('checkbox', { name: 'in_progress' }))

      expect(await screen.findByRole('region', { name: 'in_progress' })).toBeInTheDocument()
      expect(screen.queryByText('A real bug')).not.toBeInTheDocument()
      expect(queryRuns).toBe(1)
    })

    it('resolves a query hit that only the closed half of the index holds', async () => {
      serveIndex([makeIssue({ id: 'td-done', status: 'closed', title: 'A finished bug' })])
      serveQuery(['td-done'])

      await runQuery('?type = bug')

      expect(await screen.findByText('A finished bug')).toBeInTheDocument()
      expect(screen.queryByText(/outside the loaded set/i)).not.toBeInTheDocument()
    })
  })
  describe('the url carries the list state', () => {
    const bug = makeIssue({ id: 'td-bug', status: 'open', type: 'bug', title: 'A real bug' })

    function serveList(issues = [bug]) {
      server.use(http.get('/v1/issues', () =>
        HttpResponse.json({
          ok: true,
          data: { issues, limit: 1000, offset: 0, total: issues.length, has_more: false },
        })))
    }

    it('runs a query that was in the address bar on mount', async () => {
      let seen: URL | undefined
      serveList()
      server.use(http.get('/gui/query', ({ request }) => {
        seen = new URL(request.url)
        return HttpResponse.json({ ok: true, data: { ids: ['td-bug'] } })
      }))

      renderList('/?q=type+%3D+bug')

      expect(await screen.findByText('A real bug')).toBeInTheDocument()
      expect(seen?.searchParams.get('q')).toBe('type = bug')
      // The box shows the query it ran, prefix and all.
      expect(screen.getByLabelText('Search')).toHaveValue('?type = bug')
    })

    it('sends a search that was in the address bar to td serve', async () => {
      let seen: URL | undefined
      server.use(http.get('/v1/issues', ({ request }) => {
        seen = new URL(request.url)
        return HttpResponse.json({
          ok: true,
          data: { issues: [bug], limit: 1000, offset: 0, total: 1, has_more: false },
        })
      }))

      renderList('/?search=oauth')

      expect(await screen.findByText('A real bug')).toBeInTheDocument()
      expect(seen?.searchParams.get('search')).toBe('oauth')
      expect(screen.getByLabelText('Search')).toHaveValue('oauth')
    })

    it('lights the status chips the address bar names', async () => {
      serveList()
      renderList('/?status=open&status=blocked')

      await screen.findByText('A real bug')
      expect(screen.getByRole('checkbox', { name: 'open' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'blocked' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'closed' })).not.toBeChecked()
    })

    it('sorts the way the address bar says', async () => {
      serveMixed()
      renderList('/?sort=title:desc')

      await screen.findByRole('region', { name: 'in_progress' })
      expect(renderedIds()).toEqual(['td-prog', 'td-open-a', 'td-open-c', 'td-open-b'])
    })

    it('puts a toggled status chip in the url', async () => {
      const user = userEvent.setup()
      serveList()
      renderList()
      await screen.findByText('A real bug')

      await user.click(screen.getByRole('checkbox', { name: 'in_progress' }))

      expect(url()).toBe('?status=in_progress')
    })

    it('puts a typed search in the url once the typing pauses', async () => {
      const user = userEvent.setup()
      serveList()
      renderList()
      await screen.findByText('A real bug')

      await user.type(screen.getByLabelText('Search'), 'oauth')

      await waitFor(() => expect(url()).toBe('?search=oauth'))
    })

    it('puts a query in the url when it is run', async () => {
      const user = userEvent.setup()
      serveList()
      server.use(http.get('/gui/query', () =>
        HttpResponse.json({ ok: true, data: { ids: ['td-bug'] } })))
      renderList()
      await screen.findByText('A real bug')

      await user.type(screen.getByLabelText('Search'), '?type = bug{Enter}')

      await waitFor(() => expect(url()).toBe('?q=type+%3D+bug'))
    })

    it('puts the sort in the url, and leaves the default one out of it', async () => {
      const user = userEvent.setup()
      serveMixed()
      renderList()
      await screen.findByRole('region', { name: 'in_progress' })

      await user.click(screen.getByRole('button', { name: 'Sort by updated, ascending' }))
      expect(url()).toBe('?sort=updated%3Aasc')

      await user.click(screen.getByRole('button', { name: 'Sort by priority, ascending' }))
      expect(url()).toBe('')
    })

    it('replaces rather than pushes, so back still reaches the page before the list', async () => {
      const user = userEvent.setup()
      serveList()
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const router = createMemoryRouter([{ path: '/', element: <IssueList /> }], {
        initialEntries: ['/'],
      })
      render(
        <QueryClientProvider client={qc}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      )
      await screen.findByText('A real bug')

      await user.click(screen.getByRole('checkbox', { name: 'in_progress' }))

      expect(router.state.location.search).toBe('?status=in_progress')
      expect(router.state.historyAction).toBe('REPLACE')
    })
  })
})
