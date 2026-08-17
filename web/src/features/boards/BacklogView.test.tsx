import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import BacklogView from './BacklogView'
import { dataTransfer, makeCard } from './board.fixture'
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

  // An icon names nothing to a sighted mouse user, and dragging aside these
  // are the feature's primary pointer affordance.
  it('names the row controls on hover as well as to assistive tech', () => {
    renderBacklog()
    expect(screen.getByRole('button', { name: 'Move td-aaa down' }))
      .toHaveAttribute('title', 'Move td-aaa down')
    expect(screen.getByRole('button', { name: 'Move td-ccc up' }))
      .toHaveAttribute('title', 'Move td-ccc up')
    expect(screen.getByRole('button', { name: 'Unpin td-bbb' }))
      .toHaveAttribute('title', 'Unpin td-bbb')
  })

  /**
   * The row is drawn, not written. Unpin was a word between two arrow glyphs
   * of the same size, which read as a control bar that had lost half its
   * labels; the words belong to bars of actions, not to a card's own row.
   */
  it('gives the pinned row three controls and no text in any of them', () => {
    renderBacklog()
    for (const name of ['Move td-bbb up', 'Move td-bbb down', 'Unpin td-bbb']) {
      expect(screen.getByRole('button', { name }).textContent).toBe('')
    }
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

  // The panel shows whichever write the user last asked for, so both of them
  // have to be able to reach it.
  it("shows td's message when an unpin is rejected", async () => {
    server.use(http.delete('/v1/boards/:id/issues/:issueId', () => HttpResponse.json({
      ok: false, error: { code: 'not_found', message: 'issue not found: td-bbb' },
    }, { status: 404 })))
    renderBacklog()
    await userEvent.click(screen.getByRole('button', { name: 'Unpin td-bbb' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('issue not found: td-bbb')
  })

  /**
   * React Query keeps a mutation's error until that same mutation runs again,
   * so a rejected move outlives an unpin that succeeded. The panel would then
   * be describing a card that has already left the pinned block, in the user's
   * own words: "the move failed" — while the thing they just did worked.
   */
  it('drops a rejected move from the panel once the next write succeeds', async () => {
    server.use(http.post('/v1/boards/:id/issues', () => HttpResponse.json({
      ok: false, error: { code: 'not_found', message: 'issue not found: td-aaa' },
    }, { status: 404 })))
    renderBacklog()
    await userEvent.click(screen.getByRole('button', { name: 'Move td-aaa down' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('issue not found: td-aaa')

    await userEvent.click(screen.getByRole('button', { name: 'Unpin td-bbb' }))
    await waitFor(() => expect(cleared).toEqual(['td-bbb']))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

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

  /**
   * A gap is 6px tall. The section around it is the whole pinned block — its
   * heading, its prose and the space beside the cards — so a drop that misses
   * every gap still pins the card, at the end of the block. The gaps remain the
   * only way to name an exact slot.
   */
  it('appends a card dropped on the Pinned heading', async () => {
    renderBacklog()
    const dt = dataTransfer('td-ddd')
    fireEvent.dragStart(screen.getByText('td-ddd').closest('li')!, { dataTransfer: dt })
    fireEvent.drop(screen.getByRole('heading', { name: 'Pinned' }), { dataTransfer: dt })
    await waitFor(() => expect(positioned).toEqual([{ issue_id: 'td-ddd', position: 4 }]))
  })

  // The empty state is what the 6px gap served worst: it told the user to drag
  // a card "up here" while "here" was a transparent strip under the sentence
  // saying it. The sentence is the target now.
  it('pins a card dropped on the nothing-is-pinned text', async () => {
    renderBacklog([makeCard({ id: 'td-ddd' }, { position: 0, has_position: false })])
    const dt = dataTransfer('td-ddd')
    fireEvent.dragStart(screen.getByText('td-ddd').closest('li')!, { dataTransfer: dt })
    fireEvent.drop(screen.getByText(/Nothing is pinned/), { dataTransfer: dt })
    await waitFor(() => expect(positioned).toEqual([{ issue_id: 'td-ddd', position: 1 }]))
  })

  /**
   * A gap marks the boundary between two pinned cards. With no pinned cards
   * there is no boundary to mark, and the strip drawn where one would go is a
   * second drop target sitting inside the first, offering the same slot the
   * prose above it already offers. Two targets, one outcome: the empty state
   * renders the section and nothing else.
   */
  it('draws no gap inside the section when nothing is pinned', () => {
    renderBacklog([makeCard({ id: 'td-ddd' }, { position: 0, has_position: false })])
    expect(screen.queryAllByTestId(/^drop-gap-/)).toEqual([])
  })

  /**
   * The gaps sit inside the section, so a drop on one reaches the section's
   * handler too unless the gap stops it — and that second handler would append
   * the card the first one just placed. The proof is the same shape as the
   * self-drop test: assert the whole array, not just that it contains the move.
   */
  it('places a gap drop at that gap and nowhere else', async () => {
    renderBacklog()
    const dt = dataTransfer('td-ddd')
    fireEvent.dragStart(screen.getByText('td-ddd').closest('li')!, { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('drop-gap-0'), { dataTransfer: dt })

    const move = { issue_id: 'td-ddd', position: 1 }
    await waitFor(() => expect(positioned).toContainEqual(move))
    expect(positioned).toEqual([move])
  })

  // Same refusal `dropAt` makes at a gap: a link dragged in from another window
  // arrives as its URL, and td would answer a 404 the user did nothing to earn.
  it('ignores a drop on the section whose payload is not a card on this board', async () => {
    renderBacklog()
    fireEvent.drop(screen.getByRole('heading', { name: 'Pinned' }), {
      dataTransfer: dataTransfer('https://example.com'),
    })

    const move = { issue_id: 'td-ddd', position: 4 }
    const dt = dataTransfer('td-ddd')
    fireEvent.dragStart(screen.getByText('td-ddd').closest('li')!, { dataTransfer: dt })
    fireEvent.drop(screen.getByRole('heading', { name: 'Pinned' }), { dataTransfer: dt })
    await waitFor(() => expect(positioned).toContainEqual(move))
    expect(positioned).toEqual([move])
  })

  // Without preventDefault on dragover the browser refuses the drop outright.
  it('accepts the drag over the section', () => {
    renderBacklog()
    const heading = screen.getByRole('heading', { name: 'Pinned' })
    const event = createEvent.dragOver(heading, { dataTransfer: dataTransfer('td-ddd') })
    fireEvent(heading, event)
    expect(event.defaultPrevented).toBe(true)
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

  const sectionState = () =>
    screen.getByTestId('pinned-dropzone').getAttribute('data-state')

  it('shows the whole section will take the drop once a card is picked up', () => {
    renderBacklog()
    expect(sectionState()).toBe('idle')

    fireEvent.dragStart(screen.getByText('td-ddd').closest('li')!, {
      dataTransfer: dataTransfer('td-ddd'),
    })
    expect(sectionState()).toBe('armed')
  })

  /**
   * Two highlights must never both read as "the card lands here". The gaps say
   * where an exact slot is; the section says the coarse fallback is what a drop
   * would take, so it goes active only while no gap is under the cursor.
   */
  it('marks the section, and no gap, while the cursor is on its heading', () => {
    renderBacklog()
    const dt = dataTransfer('td-ddd')
    fireEvent.dragStart(screen.getByText('td-ddd').closest('li')!, { dataTransfer: dt })

    fireEvent.dragOver(screen.getByRole('heading', { name: 'Pinned' }), { dataTransfer: dt })
    expect(sectionState()).toBe('active')
    expect(gapStates()).toEqual(['armed', 'armed', 'armed', 'armed'])
  })

  it('hands the mark back to a gap when the cursor reaches one', () => {
    renderBacklog()
    const dt = dataTransfer('td-ddd')
    fireEvent.dragStart(screen.getByText('td-ddd').closest('li')!, { dataTransfer: dt })
    fireEvent.dragOver(screen.getByRole('heading', { name: 'Pinned' }), { dataTransfer: dt })

    fireEvent.dragOver(screen.getByTestId('drop-gap-1'), { dataTransfer: dt })
    expect(gapStates()).toEqual(['armed', 'active', 'armed', 'armed'])
    expect(sectionState()).toBe('armed')
  })

  /**
   * As in SwimlaneView's suite: jsdom drops `relatedTarget` from the init, so
   * passing it to fireEvent.dragLeave looks right and measures nothing. The
   * section's guard reads exactly that field, so it has to be defined on the
   * event or the test proves the opposite of what it says.
   */
  function leave(target: HTMLElement, relatedTarget: HTMLElement | null) {
    const event = createEvent.dragLeave(target)
    Object.defineProperty(event, 'relatedTarget', { value: relatedTarget })
    fireEvent(target, event)
  }

  // dragleave bubbles out of everything inside the section — every gap, every
  // card — so clearing on each of them would unmark the section that the
  // dragover about to follow immediately marks again.
  it('keeps the section marked as the cursor crosses what is inside it', () => {
    renderBacklog()
    const dt = dataTransfer('td-ddd')
    fireEvent.dragStart(screen.getByText('td-ddd').closest('li')!, { dataTransfer: dt })
    fireEvent.dragOver(screen.getByRole('heading', { name: 'Pinned' }), { dataTransfer: dt })

    leave(screen.getByRole('heading', { name: 'Pinned' }),
      screen.getByRole('list', { name: 'Pinned' }))
    expect(sectionState()).toBe('active')
  })

  it('unmarks the section when the cursor leaves it altogether', () => {
    renderBacklog()
    const dt = dataTransfer('td-ddd')
    fireEvent.dragStart(screen.getByText('td-ddd').closest('li')!, { dataTransfer: dt })
    fireEvent.dragOver(screen.getByRole('heading', { name: 'Pinned' }), { dataTransfer: dt })

    leave(screen.getByTestId('pinned-dropzone'),
      screen.getByRole('list', { name: 'Ordered by the board query' }))
    expect(sectionState()).toBe('armed')
  })

  /**
   * `dropAt` refuses while a write is in flight, and the section shares it. A
   * region that lit up anyway would be advertising a drop the handler discards
   * without a word.
   */
  it('leaves the section dark while a position write is in flight', async () => {
    const release = heldPosition()
    renderBacklog()
    await userEvent.click(screen.getByRole('button', { name: 'Move td-aaa down' }))
    await waitFor(() =>
      expect(screen.getByRole('list', { name: 'Pinned' })).toHaveAttribute('aria-busy', 'true'))

    fireEvent.dragStart(screen.getByText('td-ccc').closest('li')!, {
      dataTransfer: dataTransfer('td-ccc'),
    })
    expect(sectionState()).toBe('idle')
    release()
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

  /** The row of a pinned card, controls and all. */
  const rowOf = (issueId: string) => screen.getByTestId(`card-${issueId}`).closest('li')!

  /** The pinned list itself — in a real browser, the margins between its rows. */
  const pinnedList = () => screen.getByRole('list', { name: 'Pinned' })

  /**
   * The section is the coarse fallback for the chrome around the block — its
   * heading, its prose, the space beside the cards. The card rows are most of
   * its area and are not chrome: a row is where a card already is, so a drop
   * there names no new place. Left to bubble, it would reach the section and
   * append, which is the standard cancel gesture — pick a card up, put it back
   * where it was — silently reordering the board.
   */
  it('refuses the drag over a pinned card row', () => {
    renderBacklog()
    const row = rowOf('td-bbb')
    const event = createEvent.dragOver(row, { dataTransfer: dataTransfer('td-ddd') })
    fireEvent(row, event)
    expect(event.defaultPrevented).toBe(false)
  })

  // Picking a card up and putting it back down is how a drag is cancelled.
  // Proof of the whole array, as in the gap self-drop test: a real move is
  // issued last and awaited, so anything the no-op sent would be recorded too.
  it('sends nothing when a pinned card is dropped on its own row', async () => {
    renderBacklog()
    const dt = dataTransfer('td-aaa')
    fireEvent.dragStart(rowOf('td-aaa'), { dataTransfer: dt })
    fireEvent.drop(rowOf('td-aaa'), { dataTransfer: dt })

    const move = { issue_id: 'td-aaa', position: 3 }
    fireEvent.drop(screen.getByTestId('drop-gap-2'), { dataTransfer: dt })
    await waitFor(() => expect(positioned).toContainEqual(move))
    expect(positioned).toEqual([move])
  })

  // A row is not a slot either: dropping on td-bbb says nothing about whether
  // the card belongs above or below it, and appending to the end of the block
  // is not what the gesture asked for.
  it('sends nothing when a card is dropped on another pinned row', async () => {
    renderBacklog()
    const dt = dataTransfer('td-ddd')
    fireEvent.dragStart(rowOf('td-ddd'), { dataTransfer: dt })
    fireEvent.drop(rowOf('td-bbb'), { dataTransfer: dt })

    const move = { issue_id: 'td-ddd', position: 1 }
    fireEvent.drop(screen.getByTestId('drop-gap-0'), { dataTransfer: dt })
    await waitFor(() => expect(positioned).toContainEqual(move))
    expect(positioned).toEqual([move])
  })

  /**
   * A row takes no drop, so nothing may read as "the card lands here" while the
   * cursor is on one — least of all the section, whose accent paint would be
   * promising an append the row is about to refuse.
   */
  it('marks nothing active while the cursor is on a card row', () => {
    renderBacklog()
    const dt = dataTransfer('td-ddd')
    fireEvent.dragStart(rowOf('td-ddd'), { dataTransfer: dt })
    fireEvent.dragOver(screen.getByRole('heading', { name: 'Pinned' }), { dataTransfer: dt })
    expect(sectionState()).toBe('active')

    fireEvent.dragOver(rowOf('td-bbb'), { dataTransfer: dt })
    expect(sectionState()).toBe('armed')
    expect(gapStates()).toEqual(['armed', 'armed', 'armed', 'armed'])
  })

  /**
   * The list is `space-y-1.5`, which is a 6px margin between every child. A
   * margin is outside the child's box but inside the list's, so those strips
   * belong to the list itself — and with the rows inert but the list not, a
   * drop landing in one bubbled past them to the section and appended.
   *
   * That put a 6px append band on each side of every gap: missing the slot the
   * user aimed at by three pixels sent the card to the bottom of the block
   * instead. The premise of this whole feature is that 6px is not a target a
   * dragged card can hit, so those bands are the last place a silent write
   * belongs. The list refuses the drag for the same reason a row does.
   */
  it('sends nothing when a card is dropped between the rows', async () => {
    renderBacklog()
    const dt = dataTransfer('td-aaa')
    fireEvent.dragStart(rowOf('td-aaa'), { dataTransfer: dt })
    fireEvent.drop(pinnedList(), { dataTransfer: dt })

    const move = { issue_id: 'td-aaa', position: 3 }
    fireEvent.drop(screen.getByTestId('drop-gap-2'), { dataTransfer: dt })
    await waitFor(() => expect(positioned).toContainEqual(move))
    expect(positioned).toEqual([move])
  })

  it('refuses the drag over the space between the rows', () => {
    renderBacklog()
    const list = pinnedList()
    const event = createEvent.dragOver(list, { dataTransfer: dataTransfer('td-ddd') })
    fireEvent(list, event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('marks nothing active while the cursor is between the rows', () => {
    renderBacklog()
    const dt = dataTransfer('td-ddd')
    fireEvent.dragStart(rowOf('td-ddd'), { dataTransfer: dt })
    fireEvent.dragOver(screen.getByRole('heading', { name: 'Pinned' }), { dataTransfer: dt })
    expect(sectionState()).toBe('active')

    fireEvent.dragOver(pinnedList(), { dataTransfer: dt })
    expect(sectionState()).toBe('armed')
    expect(gapStates()).toEqual(['armed', 'armed', 'armed', 'armed'])
  })

  /**
   * Refusing a drop is not the same as ignoring it. The section arms on any
   * payload without inspecting it, so a link or a file dragged in from another
   * window makes the browser offer the drop; if one then landed on the list,
   * an uncancelled default is navigate-to-URL or open-file, which takes the
   * page down. Every other drop path here cancels on its first line.
   */
  it('cancels the browser default on a drop it refuses', () => {
    renderBacklog()
    const list = pinnedList()
    const event = createEvent.drop(list, { dataTransfer: dataTransfer('https://example.com') })
    fireEvent(list, event)
    expect(event.defaultPrevented).toBe(true)
  })
})
