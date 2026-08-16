import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import BacklogView from './BacklogView'
import { makeCard } from './board.fixture'
import type { BoardCard } from '../../api/types'

const positioned: unknown[] = []
const cleared: string[] = []

const server = setupServer(
  http.post('/v1/boards/:id/issues', async ({ request }) => {
    positioned.push(await request.json())
    return HttpResponse.json({ ok: true, data: { positioned: true } })
  }),
  http.delete('/v1/boards/:id/issues/:issueId', ({ params }) => {
    cleared.push(String(params.issueId))
    return HttpResponse.json({ ok: true, data: { deleted: true } })
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  positioned.length = 0
  cleared.length = 0
})
afterAll(() => server.close())

/** Three pinned cards and one that the board query brought in unpositioned. */
function cards(): BoardCard[] {
  return [
    makeCard({ id: 'td-aaa' }, { position: 1000, has_position: true }),
    makeCard({ id: 'td-bbb' }, { position: 2000, has_position: true }),
    makeCard({ id: 'td-ccc' }, { position: 3000, has_position: true }),
    makeCard({ id: 'td-ddd' }, { position: 0, has_position: false }),
  ]
}

function renderBacklog(list: BoardCard[] = cards()) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><BacklogView boardId="bd-sprint1" cards={list} /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BacklogView', () => {
  it('separates pinned cards from the ones the query ordered', () => {
    renderBacklog()
    const pinned = screen.getByRole('list', { name: 'Pinned' })
    const auto = screen.getByRole('list', { name: 'Ordered by the board query' })
    expect(pinned).toHaveTextContent('td-aaa')
    expect(pinned).not.toHaveTextContent('td-ddd')
    expect(auto).toHaveTextContent('td-ddd')
  })

  // Moving down by one is gap = index + 2, because the card still holds
  // index + 1's left edge in td's stored rows. Anything else is a silent no-op.
  it('moves a card down with the slot two below it', async () => {
    renderBacklog()
    await userEvent.click(screen.getByRole('button', { name: 'Move td-aaa down' }))
    expect(positioned).toEqual([{ issue_id: 'td-aaa', position: 3 }])
  })

  it('moves a card up with the gap before its predecessor', async () => {
    renderBacklog()
    await userEvent.click(screen.getByRole('button', { name: 'Move td-ccc up' }))
    expect(positioned).toEqual([{ issue_id: 'td-ccc', position: 2 }])
  })

  it('cannot move the first card up or the last one down', () => {
    renderBacklog()
    expect(screen.getByRole('button', { name: 'Move td-aaa up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move td-ccc down' })).toBeDisabled()
  })

  it('unpins a card', async () => {
    renderBacklog()
    await userEvent.click(screen.getByRole('button', { name: 'Unpin td-bbb' }))
    expect(cleared).toEqual(['td-bbb'])
  })

  // Nothing below the line has an order to move within, so it gets no controls.
  it('offers no move or unpin controls on an unpinned card', () => {
    renderBacklog()
    expect(screen.queryByRole('button', { name: 'Move td-ddd up' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unpin td-ddd' })).not.toBeInTheDocument()
  })

  it('says nothing is pinned yet when no card has a position', () => {
    renderBacklog([makeCard({ id: 'td-ddd' }, { position: 0, has_position: false })])
    expect(screen.getByText(/Nothing is pinned/)).toBeInTheDocument()
  })

  it("shows td's message when a position is rejected", async () => {
    server.use(http.post('/v1/boards/:id/issues', () => HttpResponse.json({
      ok: false, error: { code: 'not_found', message: 'issue not found: td-aaa' },
    }, { status: 404 })))
    renderBacklog()
    await userEvent.click(screen.getByRole('button', { name: 'Move td-aaa down' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('issue not found: td-aaa')
  })

  /**
   * jsdom implements neither DataTransfer nor the drag lifecycle, so the
   * exchange is stubbed. That is the whole contract the component relies on:
   * the issue id goes out on dragstart and comes back on drop.
   */
  function dataTransfer(id: string) {
    const store: Record<string, string> = { 'text/plain': id }
    return {
      dropEffect: '', effectAllowed: '',
      setData: (type: string, value: string) => { store[type] = value },
      getData: (type: string) => store[type] ?? '',
    }
  }

  it('drops a pinned card into a higher gap', async () => {
    renderBacklog()
    const dt = dataTransfer('td-ccc')
    fireEvent.dragStart(screen.getByText('td-ccc').closest('li')!, { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('drop-gap-1'), { dataTransfer: dt })
    await waitFor(() => expect(positioned).toEqual([{ issue_id: 'td-ccc', position: 2 }]))
  })

  it('pins a card dragged up from the query-ordered block', async () => {
    renderBacklog()
    const dt = dataTransfer('td-ddd')
    fireEvent.dragStart(screen.getByText('td-ddd').closest('li')!, { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('drop-gap-0'), { dataTransfer: dt })
    await waitFor(() => expect(positioned).toEqual([{ issue_id: 'td-ddd', position: 1 }]))
  })

  it('appends a card dropped at the end of the pinned block', async () => {
    renderBacklog()
    const dt = dataTransfer('td-ddd')
    fireEvent.dragStart(screen.getByText('td-ddd').closest('li')!, { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('drop-gap-3'), { dataTransfer: dt })
    await waitFor(() => expect(positioned).toEqual([{ issue_id: 'td-ddd', position: 4 }]))
  })

  // Dropping a card onto its own place would rewrite a sort key and can
  // trigger a respacing pass in td, all to leave the order exactly as it was.
  it('sends nothing when a card is dropped onto its own place', async () => {
    renderBacklog()
    const dt = dataTransfer('td-bbb')
    fireEvent.dragStart(screen.getByText('td-bbb').closest('li')!, { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('drop-gap-1'), { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('drop-gap-2'), { dataTransfer: dt })
    expect(positioned).toEqual([])
  })

  // Without preventDefault on dragover the browser refuses the drop outright.
  it('accepts the drag over a gap', () => {
    renderBacklog()
    const event = createEvent.dragOver(screen.getByTestId('drop-gap-0'), {
      dataTransfer: dataTransfer('td-ddd'),
    })
    fireEvent(screen.getByTestId('drop-gap-0'), event)
    expect(event.defaultPrevented).toBe(true)
  })
})
