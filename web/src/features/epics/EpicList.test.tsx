import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import EpicList from './EpicList'
import { makeIssue } from '../issues/issue.fixture'
import { FETCH_LIMIT } from '../../api/queries'
import type { Issue } from '../../api/types'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

/**
 * Renders the page against a stubbed index, keyed the way `useIssueIndex`
 * splits it: `''` is the unfiltered half td reads as "everything but closed",
 * `'closed'` is the second request that fetches the rest.
 */
function renderList(byStatus: Record<string, Issue[]>) {
  server.use(http.get('/v1/issues', ({ request }) => {
    const status = new URL(request.url).searchParams.getAll('status')
    const issues = byStatus[status.join(',')] ?? []
    return HttpResponse.json({
      ok: true,
      data: { issues, limit: FETCH_LIMIT, offset: 0, total: issues.length, has_more: false },
    })
  }))

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/epics']}><EpicList /></MemoryRouter>
    </QueryClientProvider>,
  )
}

/** The id links, in the order the rows were rendered. */
const renderedIds = () =>
  screen.getAllByRole('link', { name: /^td-ep/ }).map(link => link.textContent)

const epic = (over: Partial<Issue>) => makeIssue({ type: 'epic', ...over })

describe('EpicList', () => {
  // `type === 'epic'` is what td epic list means by an epic, and deliberately
  // not "any issue with children": parent_id carries no restriction to epic
  // parents, so a feature with tasks keeps them on its own detail view and
  // stays out of this page.
  it('lists the issues of type epic and nothing else', async () => {
    renderList({ '': [
      epic({ id: 'td-ep1', title: 'The epic' }),
      makeIssue({ id: 'td-feat0', type: 'feature', title: 'A feature with tasks' }),
      makeIssue({ id: 'td-task0', type: 'task', parent_id: 'td-feat0' }),
    ] })

    expect(await screen.findByText('The epic')).toBeInTheDocument()
    expect(screen.queryByText('A feature with tasks')).not.toBeInTheDocument()
  })

  // The CLI's own order, so a reader with `td epic list` open beside the page
  // does not have to re-find a row.
  it('sorts by priority, then by creation date', async () => {
    renderList({ '': [
      epic({ id: 'td-ep1', priority: 'P2', created_at: '2026-01-01T00:00:00Z' }),
      epic({ id: 'td-ep2', priority: 'P0', created_at: '2026-03-01T00:00:00Z' }),
      epic({ id: 'td-ep3', priority: 'P2', created_at: '2026-02-01T00:00:00Z' }),
    ] })

    await screen.findByRole('link', { name: 'td-ep1' })
    expect(renderedIds()).toEqual(['td-ep2', 'td-ep1', 'td-ep3'])
  })

  it('reports the closed count over the transitive total', async () => {
    renderList({
      '': [
        epic({ id: 'td-ep1' }),
        makeIssue({ id: 'td-c1', parent_id: 'td-ep1' }),
        makeIssue({ id: 'td-g1', parent_id: 'td-c1' }),
      ],
      closed: [makeIssue({ id: 'td-c2', parent_id: 'td-ep1', status: 'closed' })],
    })

    expect(await screen.findByText('1/3')).toBeInTheDocument()
  })

  // The majority case on the measured project, and not a failure state.
  it('says an epic with no tasks has none, rather than nought percent', async () => {
    renderList({ '': [epic({ id: 'td-ep1' })] })

    expect(await screen.findByText('no tasks')).toBeInTheDocument()
  })

  it('shows the direct children when a row is expanded, and hides them again', async () => {
    renderList({ '': [
      epic({ id: 'td-ep1' }),
      makeIssue({ id: 'td-c1', title: 'First task', parent_id: 'td-ep1' }),
      makeIssue({ id: 'td-c2', title: 'Second task', parent_id: 'td-ep1' }),
    ] })

    const chevron = await screen.findByRole('button', { name: 'Tasks of td-ep1' })
    expect(chevron).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('First task')).not.toBeInTheDocument()

    await userEvent.click(chevron)

    expect(chevron).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('First task')).toBeInTheDocument()
    expect(screen.getByText('Second task')).toBeInTheDocument()

    await userEvent.click(chevron)

    expect(screen.queryByText('First task')).not.toBeInTheDocument()
  })

  // The rollup counts the whole subtree while the expansion shows one level,
  // so without this a deep epic would claim more tasks than it lists. The
  // child's own count is what makes the two numbers reconcile on screen.
  it('gives an expanded child that has children of its own a count', async () => {
    renderList({
      '': [
        epic({ id: 'td-ep1' }),
        makeIssue({ id: 'td-c1', title: 'A task with subtasks', parent_id: 'td-ep1' }),
        makeIssue({ id: 'td-g1', parent_id: 'td-c1' }),
      ],
      closed: [makeIssue({ id: 'td-g2', parent_id: 'td-c1', status: 'closed' })],
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Tasks of td-ep1' }))

    expect(screen.getByText('1/2')).toBeInTheDocument()
  })

  it('offers no chevron on an epic with no tasks', async () => {
    renderList({ '': [epic({ id: 'td-ep1' })] })

    await screen.findByRole('link', { name: 'td-ep1' })
    expect(screen.queryByRole('button', { name: 'Tasks of td-ep1' })).not.toBeInTheDocument()
  })

  it('links each row to the create form with the epic as the parent', async () => {
    renderList({ '': [epic({ id: 'td-ep1' })] })

    expect(await screen.findByRole('link', { name: 'New task under td-ep1' }))
      .toHaveAttribute('href', '/new?parent=td-ep1')
  })

  it('hides closed epics until the chip is switched on', async () => {
    renderList({
      '': [epic({ id: 'td-ep1', title: 'Still going' })],
      closed: [epic({ id: 'td-ep9', title: 'Finished', status: 'closed' })],
    })

    const chip = await screen.findByRole('checkbox', { name: 'closed (1)' })
    expect(screen.queryByText('Finished')).not.toBeInTheDocument()

    await userEvent.click(chip)

    expect(screen.getByText('Finished')).toBeInTheDocument()
    expect(screen.getByText('Still going')).toBeInTheDocument()
  })

  // A control that toggles between one empty set and the same empty set
  // answers nothing.
  it('offers no closed chip when no epic is closed', async () => {
    renderList({ '': [epic({ id: 'td-ep1' })] })

    await screen.findByRole('link', { name: 'td-ep1' })
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('explains what an epic is when the project has none, and links to the form', async () => {
    renderList({ '': [makeIssue({ id: 'td-task0', type: 'task' })] })

    expect(await screen.findByText('No epics yet.')).toBeInTheDocument()
    expect(screen.getByText(/an issue of type epic/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New issue' })).toHaveAttribute('href', '/new')
  })

  // "No epics yet" in front of a project whose epics are all closed would be a
  // lie, and it would point at the wrong control.
  it('points at the chip when every epic is closed', async () => {
    renderList({ closed: [epic({ id: 'td-ep9', status: 'closed' })] })

    expect(await screen.findByText('No open epics.')).toBeInTheDocument()
    expect(screen.queryByText('No epics yet.')).not.toBeInTheDocument()
  })

  // A rollup computed off a partial index is a lower bound. Saying so beats
  // presenting the number as fact.
  it('admits that the counts may undercount when the index came back full', async () => {
    const half = Array.from({ length: FETCH_LIMIT }, (_, i) =>
      makeIssue({ id: `td-fill${i}`, type: 'task' }))

    renderList({ '': [...half.slice(1), epic({ id: 'td-ep1' })] })

    expect(await screen.findByText(/may be undercounting/)).toBeInTheDocument()
  })

  it('says nothing about the cap when neither half filled its page', async () => {
    renderList({ '': [epic({ id: 'td-ep1' })] })

    await screen.findByRole('link', { name: 'td-ep1' })
    expect(screen.queryByText(/may be undercounting/)).not.toBeInTheDocument()
  })
})
