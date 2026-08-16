import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { delay, http, HttpResponse } from 'msw'
import DependencyPanel from './DependencyPanel'
import type { Dependency, Issue } from '../../api/types'
import { makeIssue } from './issue.fixture'

const server = setupServer(
  // The issue index the panel resolves blocker titles against. Empty by
  // default: the tests that care about resolution override it.
  http.get('/v1/issues', () => HttpResponse.json({
    ok: true, data: { issues: [], limit: 1000, offset: 0, total: 0, has_more: false },
  })),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const dependency: Dependency = {
  dep_id: 'dep_f7585e15', issue_id: 'td-6a0883',
  depends_on_id: 'td-ffe762', relation_type: 'depends_on',
}

function renderPanel(dependencies: Dependency[], blockedBy: Dependency[] = []) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DependencyPanel
          issueId="td-6a0883" dependencies={dependencies} blockedBy={blockedBy} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('DependencyPanel', () => {
  it('shows each blocker with its title, status and a remove control', async () => {
    server.use(http.get('/v1/issues', () => HttpResponse.json({
      ok: true,
      data: {
        issues: [makeIssue({ id: 'td-blk', title: 'The blocker', status: 'in_progress' })],
        limit: 1000, offset: 0, total: 1, has_more: false,
      },
    })))

    renderPanel([{ dep_id: 'dep_1', issue_id: 'td-6a0883', depends_on_id: 'td-blk', relation_type: 'depends_on' }])

    expect(await screen.findByText('The blocker')).toBeInTheDocument()
    expect(screen.getByText('in_progress')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove td-blk' })).toBeInTheDocument()
  })

  // A finished dependency is not current work. Mixing the two makes a
  // long-closed blocker read as something still in the way.
  it('separates closed blockers from the ones still blocking, each keeping its title and remove control', async () => {
    server.use(http.get('/v1/issues', () => HttpResponse.json({
      ok: true,
      data: {
        issues: [
          makeIssue({ id: 'td-open', title: 'Still blocking', status: 'open' }),
          makeIssue({ id: 'td-done', title: 'Already done', status: 'closed' }),
        ],
        limit: 1000, offset: 0, total: 2, has_more: false,
      },
    })))

    renderPanel([
      { dep_id: 'dep_1', issue_id: 'td-6a0883', depends_on_id: 'td-open', relation_type: 'depends_on' },
      { dep_id: 'dep_2', issue_id: 'td-6a0883', depends_on_id: 'td-done', relation_type: 'depends_on' },
    ])

    expect(await screen.findByText('Depends on (1)')).toBeInTheDocument()
    expect(screen.getByText('Resolved (1)')).toBeInTheDocument()

    // Both groups render the blocker's title and status, and both keep the
    // remove control — a closed dependency is still a dependency to remove.
    expect(screen.getByText('Still blocking')).toBeInTheDocument()
    expect(screen.getByText('open')).toBeInTheDocument()
    expect(screen.getByText('Already done')).toBeInTheDocument()
    expect(screen.getByText('closed')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Remove td-/ })).toHaveLength(2)
  })

  // Every row's control reads "Remove", so a list of N blockers used to expose
  // N buttons with one indistinguishable accessible name. The id is on the row
  // already and is unique per blocker, so it is what names the control — the
  // title can be missing, and two issues can share one.
  it('names each remove control after the blocker it would take off', async () => {
    server.use(http.get('/v1/issues', () => HttpResponse.json({
      ok: true,
      data: {
        issues: [
          makeIssue({ id: 'td-open', title: 'Still blocking', status: 'open' }),
          makeIssue({ id: 'td-done', title: 'Already done', status: 'closed' }),
        ],
        limit: 1000, offset: 0, total: 2, has_more: false,
      },
    })))

    renderPanel([
      { dep_id: 'dep_1', issue_id: 'td-6a0883', depends_on_id: 'td-open', relation_type: 'depends_on' },
      { dep_id: 'dep_2', issue_id: 'td-6a0883', depends_on_id: 'td-done', relation_type: 'depends_on' },
    ])

    // The visible label stays "Remove"; only the accessible name says which.
    expect(await screen.findByRole('button', { name: 'Remove td-open' }))
      .toHaveTextContent('Remove')
    expect(screen.getByRole('button', { name: 'Remove td-done' })).toBeInTheDocument()
  })

  // An unresolved blocker has no title to fall back on, and its control still
  // has to name its target.
  it('names the remove control of a blocker the index does not hold', async () => {
    renderPanel([{ dep_id: 'dep_1', issue_id: 'td-6a0883', depends_on_id: 'td-gone', relation_type: 'depends_on' }])

    expect(await screen.findByRole('button', { name: 'Remove td-gone' })).toBeInTheDocument()
  })

  it('keeps a blocker the index does not hold in the active group', async () => {
    server.use(http.get('/v1/issues', () => HttpResponse.json({
      ok: true, data: { issues: [], limit: 1000, offset: 0, total: 0, has_more: false },
    })))

    renderPanel([{ dep_id: 'dep_1', issue_id: 'td-6a0883', depends_on_id: 'td-gone', relation_type: 'depends_on' }])

    expect(await screen.findByText('Depends on (1)')).toBeInTheDocument()
    expect(screen.queryByText('Resolved (1)')).not.toBeInTheDocument()
  })

  it('posts depends_on when a dependency is added', async () => {
    let body: unknown
    server.use(http.post('/v1/issues/td-6a0883/dependencies', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ ok: true, data: { dependency } })
    }))
    renderPanel([])

    await userEvent.type(screen.getByLabelText('Depends on'), 'td-ffe762')
    await userEvent.click(screen.getByRole('button', { name: 'Add dependency' }))

    await waitFor(() => expect(body).toEqual({ depends_on: 'td-ffe762' }))
  })

  // These errors carry no details.fields, so binding them to a field would
  // show nothing at all.
  it("shows td's circular-dependency message verbatim", async () => {
    server.use(http.post('/v1/issues/td-6a0883/dependencies', () =>
      HttpResponse.json({
        ok: false,
        error: { code: 'validation_error', message: 'cannot add dependency: would create circular dependency' },
      }, { status: 400 })))
    renderPanel([])

    await userEvent.type(screen.getByLabelText('Depends on'), 'td-6a0883')
    await userEvent.click(screen.getByRole('button', { name: 'Add dependency' }))

    expect(await screen.findByText('cannot add dependency: would create circular dependency')).toBeInTheDocument()
  })

  it('removes a dependency by dep_id after confirming', async () => {
    let removed = ''
    server.use(http.delete('/v1/issues/td-6a0883/dependencies/:depId', ({ params }) => {
      removed = String(params.depId)
      return HttpResponse.json({ ok: true, data: { removed: true } })
    }))
    renderPanel([dependency])

    await userEvent.click(screen.getByRole('button', { name: 'Remove td-ffe762' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm remove' }))

    await waitFor(() => expect(removed).toBe('dep_f7585e15'))
  })

  it('renders nothing but the add control when there are no dependencies', () => {
    renderPanel([])
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  // The Add dependency button disables on add.isPending, but that reads from
  // state and doesn't stop the form's native submit event — two submits
  // landing before a render commits both read isPending as false and each
  // add the dependency. Same shape as IssueForm.tsx had.
  it('adds only one dependency when the form is submitted twice in a row', async () => {
    let count = 0
    server.use(http.post('/v1/issues/td-6a0883/dependencies', async () => {
      count += 1
      await delay(20)
      return HttpResponse.json({ ok: true, data: { dependency } })
    }))
    renderPanel([])

    await userEvent.type(screen.getByLabelText('Depends on'), 'td-ffe762')
    const form = screen.getByRole('button', { name: 'Add dependency' }).closest('form')!

    fireEvent.submit(form)
    fireEvent.submit(form)

    await expect.poll(() => count).toBe(1)
  })

  it('fires no request for a whitespace-only entry', async () => {
    let called = false
    server.use(http.post('/v1/issues/td-6a0883/dependencies', () => {
      called = true
      return HttpResponse.json({ ok: true, data: { dependency } })
    }))
    renderPanel([])

    await userEvent.type(screen.getByLabelText('Depends on'), '   ')
    await userEvent.click(screen.getByRole('button', { name: 'Add dependency' }))

    expect(called).toBe(false)
  })

  it('clears a stale add error when a subsequent remove succeeds', async () => {
    server.use(http.post('/v1/issues/td-6a0883/dependencies', () =>
      HttpResponse.json({
        ok: false,
        error: { code: 'validation_error', message: 'cannot add dependency: would create circular dependency' },
      }, { status: 400 })))
    renderPanel([dependency])

    await userEvent.type(screen.getByLabelText('Depends on'), 'td-6a0883')
    await userEvent.click(screen.getByRole('button', { name: 'Add dependency' }))
    expect(await screen.findByText('cannot add dependency: would create circular dependency')).toBeInTheDocument()

    server.use(http.delete('/v1/issues/td-6a0883/dependencies/:depId', () =>
      HttpResponse.json({ ok: true, data: { removed: true } })))

    await userEvent.click(screen.getByRole('button', { name: 'Remove td-ffe762' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm remove' }))

    await waitFor(() => expect(
      screen.queryByText('cannot add dependency: would create circular dependency'),
    ).not.toBeInTheDocument())
  })

  it('shows the fresh remove error, not a stale add error, when both fail', async () => {
    server.use(http.post('/v1/issues/td-6a0883/dependencies', () =>
      HttpResponse.json({
        ok: false,
        error: { code: 'validation_error', message: 'cannot add dependency: would create circular dependency' },
      }, { status: 400 })))
    renderPanel([dependency])

    await userEvent.type(screen.getByLabelText('Depends on'), 'td-6a0883')
    await userEvent.click(screen.getByRole('button', { name: 'Add dependency' }))
    expect(await screen.findByText('cannot add dependency: would create circular dependency')).toBeInTheDocument()

    server.use(http.delete('/v1/issues/td-6a0883/dependencies/:depId', () =>
      HttpResponse.json({
        ok: false,
        error: { code: 'not_found', message: 'dependency not found: dep_f7585e15' },
      }, { status: 404 })))

    await userEvent.click(screen.getByRole('button', { name: 'Remove td-ffe762' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm remove' }))

    expect(await screen.findByText('dependency not found: dep_f7585e15')).toBeInTheDocument()
    expect(screen.queryByText('cannot add dependency: would create circular dependency')).not.toBeInTheDocument()
  })

  it('posts the id of a suggestion picked by title', async () => {
    server.use(http.get('/v1/issues', () => HttpResponse.json({
      ok: true,
      data: {
        issues: [makeIssue({ id: 'td-pick', title: 'The one to depend on' })],
        limit: 1000, offset: 0, total: 1, has_more: false,
      },
    })))
    let body: unknown
    server.use(http.post('/v1/issues/td-6a0883/dependencies', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ ok: true, data: { dependency } })
    }))
    renderPanel([])

    await userEvent.click(screen.getByLabelText('Depends on'))
    await userEvent.click(await screen.findByText('The one to depend on'))
    await userEvent.click(screen.getByRole('button', { name: 'Add dependency' }))

    await waitFor(() => expect(body).toEqual({ depends_on: 'td-pick' }))
  })

  // Adding either would only earn a rejection from td.
  it('offers neither the issue itself nor a blocker it already has', async () => {
    server.use(http.get('/v1/issues', () => HttpResponse.json({
      ok: true,
      data: {
        issues: [
          makeIssue({ id: 'td-6a0883', title: 'The issue being viewed' }),
          makeIssue({ id: 'td-ffe762', title: 'The blocker already linked' }),
          makeIssue({ id: 'td-free', title: 'Still linkable' }),
        ],
        limit: 1000, offset: 0, total: 3, has_more: false,
      },
    })))
    renderPanel([dependency])

    await userEvent.click(screen.getByLabelText('Depends on'))

    expect(await screen.findByRole('option')).toHaveTextContent('Still linkable')
    expect(screen.getAllByRole('option')).toHaveLength(1)
  })

  // The other direction of the same rejection: td refuses the edge that would
  // close the loop, so an issue already waiting on this one is not on offer.
  it('offers no issue that already depends on this one', async () => {
    server.use(http.get('/v1/issues', () => HttpResponse.json({
      ok: true,
      data: {
        issues: [
          makeIssue({ id: 'td-waiter', title: 'Already waiting on this one' }),
          makeIssue({ id: 'td-free', title: 'Still linkable' }),
        ],
        limit: 1000, offset: 0, total: 2, has_more: false,
      },
    })))
    renderPanel([], [{
      dep_id: 'dep_rev', issue_id: 'td-waiter',
      depends_on_id: 'td-6a0883', relation_type: 'depends_on',
    }])

    await userEvent.click(screen.getByLabelText('Depends on'))

    expect(await screen.findByRole('option')).toHaveTextContent('Still linkable')
    expect(screen.getAllByRole('option')).toHaveLength(1)
  })

  // The two tests below answer the list the way td serve does, rather than
  // handing every request the same rows: td reads an absent status filter as
  // everything *except* closed, so a closed issue reaches the panel only if it
  // asks for one. A stub that ignores the filter hides exactly that.
  describe('against a list that withholds closed issues unless asked', () => {
    function stubTdList(open: Issue[], closed: Issue[]) {
      server.use(http.get('/v1/issues', ({ request }) => {
        const wantsClosed = new URL(request.url).searchParams.getAll('status').includes('closed')
        const issues = wantsClosed ? closed : open
        return HttpResponse.json({
          ok: true,
          data: { issues, limit: 1000, offset: 0, total: issues.length, has_more: false },
        })
      }))
    }

    // Work often depends on something already finished, and td accepts that
    // edge — so the picker has to be able to name it.
    it('offers a closed issue, marked closed and after the open ones', async () => {
      stubTdList(
        [makeIssue({ id: 'td-open', title: 'Still open' })],
        [makeIssue({ id: 'td-done', title: 'Long finished', status: 'closed' })],
      )
      renderPanel([])

      await userEvent.click(screen.getByLabelText('Depends on'))

      await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
      const options = screen.getAllByRole('option')
      expect(options[0]).toHaveTextContent('Still open')
      expect(options[1]).toHaveTextContent('Long finished')
      expect(options[1]).toHaveTextContent('closed')
    })

    // The Resolved group reads the blocker's status off the same index, so
    // without the closed half every finished blocker sat under "Depends on",
    // reading as something still in the way — and with no title.
    it('files a closed blocker under Resolved, with its title', async () => {
      stubTdList([], [makeIssue({ id: 'td-done', title: 'Long finished', status: 'closed' })])
      renderPanel([{
        dep_id: 'dep_1', issue_id: 'td-6a0883',
        depends_on_id: 'td-done', relation_type: 'depends_on',
      }])

      expect(await screen.findByText('Resolved (1)')).toBeInTheDocument()
      expect(screen.getByText('Long finished')).toBeInTheDocument()
      expect(screen.queryByText('Depends on (1)')).not.toBeInTheDocument()
    })
  })
})
