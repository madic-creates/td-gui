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

  // ↑ and ↓ name nothing to a sighted mouse user, and dragging aside they are
  // the feature's primary pointer affordance.
  it('names the move glyphs on hover as well as to assistive tech', () => {
    renderBacklog()
    expect(screen.getByRole('button', { name: 'Move td-aaa down' }))
      .toHaveAttribute('title', 'Move td-aaa down')
    expect(screen.getByRole('button', { name: 'Move td-ccc up' }))
      .toHaveAttribute('title', 'Move td-ccc up')
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
  //
  // The handler pushes after `await request.json()`, so asserting on an empty
  // array right after fireEvent would pass whether or not a request went out.
  // A third drop that IS a move is issued last and awaited: once its body has
  // been recorded, any request the two no-ops had issued — both started
  // earlier — would have been recorded too. The assertion is on the whole
  // array, so the no-ops have nowhere to hide.
  it('sends nothing when a card is dropped onto its own place', async () => {
    renderBacklog()
    const dt = dataTransfer('td-bbb')
    fireEvent.dragStart(screen.getByText('td-bbb').closest('li')!, { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('drop-gap-1'), { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('drop-gap-2'), { dataTransfer: dt })

    const move = { issue_id: 'td-bbb', position: 4 }
    fireEvent.drop(screen.getByTestId('drop-gap-3'), { dataTransfer: dt })
    await waitFor(() => expect(positioned).toContainEqual(move))
    expect(positioned).toEqual([move])
  })

  // A drag that started outside the board still carries text/plain — a link
  // from another window arrives as its URL. Posting that to td would name an
  // issue that does not exist and put td's 404 in the error panel, so the drop
  // is a no-op instead. Same shape of proof as the self-drop test: a real move
  // is issued last and awaited, and the assertion is on the whole array.
  it('ignores a drop whose payload is not a card on this board', async () => {
    renderBacklog()
    fireEvent.drop(screen.getByTestId('drop-gap-1'), {
      dataTransfer: dataTransfer('https://example.com'),
    })

    const move = { issue_id: 'td-ddd', position: 1 }
    const dt = dataTransfer('td-ddd')
    fireEvent.dragStart(screen.getByText('td-ddd').closest('li')!, { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('drop-gap-0'), { dataTransfer: dt })
    await waitFor(() => expect(positioned).toContainEqual(move))
    expect(positioned).toEqual([move])
  })

  /**
   * There is deliberately no optimistic reorder, so while a position write is
   * in flight the rendered order is the one td is about to replace. A second
   * drop would compute its gap against that stale layout and send a slot
   * meaning something else by the time td applies it. The buttons already
   * refuse (`disabled={busy}`) and the list already says `aria-busy` — the
   * drag path has to agree.
   */
  it('ignores a drop while a position write is in flight', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    server.use(http.post('/v1/boards/:id/issues', async ({ request }) => {
      // Recorded on entry, before the gate: a second request would show up
      // here just as the first one did, held or not.
      positioned.push(await request.json())
      await gate
      return HttpResponse.json({ ok: true, data: { positioned: true } })
    }))

    renderBacklog()
    await userEvent.click(screen.getByRole('button', { name: 'Move td-aaa down' }))
    const pinned = screen.getByRole('list', { name: 'Pinned' })
    await waitFor(() => expect(pinned).toHaveAttribute('aria-busy', 'true'))

    const card = screen.getByText('td-ccc').closest('li')!
    expect(card).toHaveAttribute('draggable', 'false')

    const dt = dataTransfer('td-ccc')
    fireEvent.dragStart(card, { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('drop-gap-1'), { dataTransfer: dt })

    // Let the held request finish. Anything the drop issued started before the
    // release and would have been recorded by the time the list settles.
    release()
    await waitFor(() => expect(pinned).toHaveAttribute('aria-busy', 'false'))
    expect(positioned).toEqual([{ issue_id: 'td-aaa', position: 3 }])
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

  /** Holds the position write open so the in-flight render can be inspected. */
  function heldPosition() {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    server.use(http.post('/v1/boards/:id/issues', async ({ request }) => {
      positioned.push(await request.json())
      await gate
      return HttpResponse.json({ ok: true, data: { positioned: true } })
    }))
    return () => release()
  }

  /**
   * The board is not reordered optimistically, so the only thing that says a
   * move is happening at all is the card's own dimming. `aria-busy` on the list
   * says a write is in flight; it does not say which card it is about.
   */
  it('dims the card being moved while the write is in flight', async () => {
    const release = heldPosition()
    renderBacklog()
    await userEvent.click(screen.getByRole('button', { name: 'Move td-aaa down' }))

    await waitFor(() => expect(screen.getByTestId('card-td-aaa')).toHaveClass('opacity-40'))
    expect(screen.getByTestId('card-td-bbb')).not.toHaveClass('opacity-40')

    release()
    await waitFor(() => expect(screen.getByTestId('card-td-aaa')).not.toHaveClass('opacity-40'))
  })

  it('dims the card being unpinned', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    server.use(http.delete('/v1/boards/:id/issues/:issueId', async () => {
      await gate
      return HttpResponse.json({ ok: true, data: { deleted: true } })
    }))

    renderBacklog()
    await userEvent.click(screen.getByRole('button', { name: 'Unpin td-bbb' }))

    await waitFor(() => expect(screen.getByTestId('card-td-bbb')).toHaveClass('opacity-40'))
    expect(screen.getByTestId('card-td-aaa')).not.toHaveClass('opacity-40')
    release()
  })

  const gapStates = () =>
    screen.getAllByTestId(/^drop-gap-/).map(gap => gap.getAttribute('data-state'))

  // A 6px transparent strip is not a target anyone can find. Picking a card up
  // is what says where the drops are.
  it('shows every gap once a card is picked up', () => {
    renderBacklog()
    expect(gapStates()).toEqual(['idle', 'idle', 'idle', 'idle'])

    fireEvent.dragStart(screen.getByText('td-ccc').closest('li')!, {
      dataTransfer: dataTransfer('td-ccc'),
    })
    expect(gapStates()).toEqual(['armed', 'armed', 'armed', 'armed'])
  })

  it('marks the gap under the cursor and clears it when the drag ends', () => {
    renderBacklog()
    const card = screen.getByText('td-ccc').closest('li')!
    const dt = dataTransfer('td-ccc')
    fireEvent.dragStart(card, { dataTransfer: dt })

    fireEvent.dragOver(screen.getByTestId('drop-gap-1'), { dataTransfer: dt })
    expect(gapStates()).toEqual(['armed', 'active', 'armed', 'armed'])

    fireEvent.dragEnd(card)
    expect(gapStates()).toEqual(['idle', 'idle', 'idle', 'idle'])
  })

  /**
   * `dropAt` refuses while a write is in flight. A gap that lit up anyway would
   * be advertising a drop the handler discards without a word.
   */
  it('leaves the gaps dark while a position write is in flight', async () => {
    const release = heldPosition()
    renderBacklog()
    await userEvent.click(screen.getByRole('button', { name: 'Move td-aaa down' }))
    await waitFor(() =>
      expect(screen.getByRole('list', { name: 'Pinned' })).toHaveAttribute('aria-busy', 'true'))

    fireEvent.dragStart(screen.getByText('td-ccc').closest('li')!, {
      dataTransfer: dataTransfer('td-ccc'),
    })
    expect(gapStates()).toEqual(['idle', 'idle', 'idle', 'idle'])
    release()
  })
})
