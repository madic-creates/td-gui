import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import SwimlaneView from './SwimlaneView'
import { makeCard } from './board.fixture'
import { makeIssue } from '../issues/issue.fixture'
import type { BoardCard } from '../../api/types'

const server = setupServer(
  http.get('/v1/issues/:id', () => HttpResponse.json({
    ok: true,
    data: {
      issue: makeIssue({ id: 'td-aaa', available_transitions: ['review'] }),
      logs: [], comments: [], dependencies: [], blocked_by: [], latest_handoff: null,
    },
  })),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function dataTransfer(id: string) {
  const store: Record<string, string> = { 'text/plain': id }
  return {
    dropEffect: '', effectAllowed: '',
    setData: (type: string, value: string) => { store[type] = value },
    getData: (type: string) => store[type] ?? '',
  }
}

function renderSwimlanes(cards: BoardCard[], includeClosed = false) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SwimlaneView cards={cards} includeClosed={includeClosed} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SwimlaneView', () => {
  it('puts each card in its status column', () => {
    renderSwimlanes([
      makeCard({ id: 'td-aaa', status: 'open' }),
      makeCard({ id: 'td-bbb', status: 'in_progress' }),
    ])
    expect(screen.getByRole('region', { name: 'Open' })).toHaveTextContent('td-aaa')
    expect(screen.getByRole('region', { name: 'In progress' })).toHaveTextContent('td-bbb')
  })

  // Without include_closed td filters closed issues out of the payload, so the
  // column would never exist on a normal board — and closing is the transition
  // a drop most often wants to propose.
  it('shows the closed column even when no closed card is on the board', () => {
    renderSwimlanes([makeCard({ id: 'td-aaa', status: 'open' })])
    expect(screen.getByRole('region', { name: 'Closed' })).toBeInTheDocument()
  })

  it('shows the closed column once a closed card is included', () => {
    renderSwimlanes([
      makeCard({ id: 'td-aaa', status: 'open' }),
      makeCard({ id: 'td-zzz', status: 'closed' }),
    ], true)
    expect(screen.getByRole('region', { name: 'Closed' })).toHaveTextContent('td-zzz')
  })

  it('opens the transition panel on a drop onto the closed column', async () => {
    renderSwimlanes([makeCard({ id: 'td-aaa', status: 'open' })])
    const dt = dataTransfer('td-aaa')
    fireEvent.dragStart(screen.getByText('td-aaa').closest('li')!, { dataTransfer: dt })
    fireEvent.drop(screen.getByRole('region', { name: 'Closed' }), { dataTransfer: dt })

    expect(await screen.findByRole('dialog', { name: 'Move td-aaa' })).toBeInTheDocument()
    expect(screen.getByText('Dropped on: Closed')).toBeInTheDocument()
  })

  it('explains the empty closed column while closed issues are filtered out', () => {
    renderSwimlanes([makeCard({ id: 'td-aaa', status: 'open' })])
    expect(screen.getByRole('region', { name: 'Closed' }))
      .toHaveTextContent('Closed issues are hidden unless you include them.')
  })

  // With the box ticked an empty column means there is nothing closed to show,
  // so the hint would be untrue.
  it('drops the hint once closed issues are included', () => {
    renderSwimlanes([makeCard({ id: 'td-aaa', status: 'open' })], true)
    expect(screen.getByRole('region', { name: 'Closed' }))
      .not.toHaveTextContent('Closed issues are hidden')
  })

  it('opens the transition panel on a cross-column drop', async () => {
    renderSwimlanes([makeCard({ id: 'td-aaa', status: 'open' })])
    const dt = dataTransfer('td-aaa')
    fireEvent.dragStart(screen.getByText('td-aaa').closest('li')!, { dataTransfer: dt })
    fireEvent.drop(screen.getByRole('region', { name: 'In review' }), { dataTransfer: dt })

    expect(await screen.findByRole('dialog', { name: 'Move td-aaa' })).toBeInTheDocument()
    expect(screen.getByText('Dropped on: In review')).toBeInTheDocument()
  })

  // td stores one position sequence per board, not one per column, so a drop
  // inside a column has no order to write and must do nothing at all.
  it('does nothing when a card is dropped on its own column', () => {
    renderSwimlanes([makeCard({ id: 'td-aaa', status: 'open' })])
    const dt = dataTransfer('td-aaa')
    fireEvent.dragStart(screen.getByText('td-aaa').closest('li')!, { dataTransfer: dt })
    fireEvent.drop(screen.getByRole('region', { name: 'Open' }), { dataTransfer: dt })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  /** Every column's data-state, in the order the board renders them. */
  const columnStates = () =>
    screen.getAllByRole('region').map(column => column.getAttribute('data-state'))

  const OPEN_CARD = [
    makeCard({ id: 'td-aaa', status: 'open' }),
    makeCard({ id: 'td-bbb', status: 'in_progress' }),
  ]

  /** Renders, picks td-aaa up, and hands back its dataTransfer. */
  function pickUpOpenCard() {
    renderSwimlanes(OPEN_CARD)
    const dt = dataTransfer('td-aaa')
    fireEvent.dragStart(screen.getByText('td-aaa').closest('li')!, { dataTransfer: dt })
    return dt
  }

  it('marks no column while nothing is being dragged', () => {
    renderSwimlanes(OPEN_CARD)
    expect(columnStates()).toEqual(['idle', 'idle', 'idle', 'idle', 'idle'])
  })

  // Which columns would take the card has to be legible before the cursor
  // reaches one of them, the way the backlog arms every gap on pick-up.
  it('arms every column a drop would change once a card is picked up', () => {
    pickUpOpenCard()
    expect(columnStates()).toEqual(['origin', 'armed', 'armed', 'armed', 'armed'])
  })

  it('marks the column under the cursor', () => {
    const dt = pickUpOpenCard()
    fireEvent.dragOver(screen.getByRole('region', { name: 'In review' }), { dataTransfer: dt })
    expect(columnStates()).toEqual(['origin', 'armed', 'armed', 'active', 'armed'])
    expect(dt.dropEffect).toBe('move')
  })

  // A drop there is a deliberate no-op, so the column must not light up as if
  // it would take the card, and the cursor should say the same.
  it('leaves the card own column neutral under the cursor', () => {
    const dt = pickUpOpenCard()
    fireEvent.dragOver(screen.getByRole('region', { name: 'Open' }), { dataTransfer: dt })
    expect(columnStates()).toEqual(['origin', 'armed', 'armed', 'armed', 'armed'])
    expect(dt.dropEffect).toBe('none')
  })

  it('moves the mark from one column to the next', () => {
    const dt = pickUpOpenCard()
    fireEvent.dragOver(screen.getByRole('region', { name: 'Blocked' }), { dataTransfer: dt })
    fireEvent.dragOver(screen.getByRole('region', { name: 'Closed' }), { dataTransfer: dt })
    expect(columnStates()).toEqual(['origin', 'armed', 'armed', 'armed', 'active'])
  })

  /**
   * jsdom implements no DragEvent, so Testing Library builds a plain Event and
   * drops `relatedTarget` from the init — passing it to fireEvent.dragLeave
   * looks right and measures nothing. It has to be defined on the event.
   */
  function leave(column: HTMLElement, relatedTarget: HTMLElement | null) {
    const event = createEvent.dragLeave(column)
    Object.defineProperty(event, 'relatedTarget', { value: relatedTarget })
    fireEvent(column, event)
  }

  /**
   * dragleave bubbles out of the cards inside a column too. Clearing on every
   * one of them would unmark the column the very dragover about to follow is
   * going to mark again — a flicker on each card the cursor crosses.
   */
  it('keeps the mark while the cursor crosses the cards inside the column', () => {
    const dt = pickUpOpenCard()
    const column = screen.getByRole('region', { name: 'In progress' })
    fireEvent.dragOver(column, { dataTransfer: dt })
    leave(column, screen.getByText('td-bbb'))
    expect(columnStates()).toEqual(['origin', 'active', 'armed', 'armed', 'armed'])
  })

  // relatedTarget is null when the drag leaves the window altogether.
  it('clears the mark when the cursor leaves the column', () => {
    const dt = pickUpOpenCard()
    const column = screen.getByRole('region', { name: 'In progress' })
    fireEvent.dragOver(column, { dataTransfer: dt })
    leave(column, null)
    expect(columnStates()).toEqual(['origin', 'armed', 'armed', 'armed', 'armed'])
  })

  it('clears every mark when the drag is abandoned', () => {
    const dt = pickUpOpenCard()
    fireEvent.dragOver(screen.getByRole('region', { name: 'Blocked' }), { dataTransfer: dt })
    fireEvent.dragEnd(screen.getByText('td-aaa').closest('li')!)
    expect(columnStates()).toEqual(['idle', 'idle', 'idle', 'idle', 'idle'])
  })

  it('clears every mark after a drop', async () => {
    const dt = pickUpOpenCard()
    fireEvent.drop(screen.getByRole('region', { name: 'In review' }), { dataTransfer: dt })
    await screen.findByRole('dialog', { name: 'Move td-aaa' })
    expect(columnStates()).toEqual(['idle', 'idle', 'idle', 'idle', 'idle'])
  })

  /**
   * A drag no card here started leaves `dragging` null, and `dropOn` discards
   * its payload without a word. Arming the columns would advertise a drop that
   * never happens — the same refusal the backlog gaps make by staying dark.
   */
  it('lights nothing for a drag that started outside the board', () => {
    renderSwimlanes(OPEN_CARD)
    const foreign = dataTransfer('https://example.com/')
    fireEvent.dragOver(screen.getByRole('region', { name: 'Blocked' }), { dataTransfer: foreign })
    expect(columnStates()).toEqual(['idle', 'idle', 'idle', 'idle', 'idle'])
  })

  // TransitionBar's reason/attribution state is local to the component
  // instance, not keyed to the issue it was opened for. Dropping a second
  // card while a form is still open for the first must remount the panel —
  // else, once the second card's issue is already cached (e.g. an earlier
  // drop already fetched it), the swap happens with no loading gap to force
  // a remount, and the leftover text would submit against the wrong issue.
  it('does not leak a half-filled form from one card to the next drop', async () => {
    server.use(http.get('/v1/issues/:id', ({ params }) => HttpResponse.json({
      ok: true,
      data: {
        issue: makeIssue({ id: params.id as string, available_transitions: ['block'] }),
        logs: [], comments: [], dependencies: [], blocked_by: [], latest_handoff: null,
      },
    })))
    renderSwimlanes([
      makeCard({ id: 'td-aaa', status: 'open' }),
      makeCard({ id: 'td-bbb', status: 'in_progress' }),
    ])

    // Warm the cache for td-bbb first, so the later drop onto it resolves
    // from cache with no intervening loading state.
    const dtWarm = dataTransfer('td-bbb')
    fireEvent.dragStart(screen.getByText('td-bbb').closest('li')!, { dataTransfer: dtWarm })
    fireEvent.drop(screen.getByRole('region', { name: 'Blocked' }), { dataTransfer: dtWarm })
    await screen.findByRole('dialog', { name: 'Move td-bbb' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const dtA = dataTransfer('td-aaa')
    fireEvent.dragStart(screen.getByText('td-aaa').closest('li')!, { dataTransfer: dtA })
    fireEvent.drop(screen.getByRole('region', { name: 'In review' }), { dataTransfer: dtA })
    expect(await screen.findByRole('dialog', { name: 'Move td-aaa' })).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Block' }))
    const reasonBox = await screen.findByLabelText('Reason')
    fireEvent.change(reasonBox, { target: { value: 'leftover reason meant for td-aaa' } })
    expect(reasonBox).toHaveValue('leftover reason meant for td-aaa')

    const dtB = dataTransfer('td-bbb')
    fireEvent.dragStart(screen.getByText('td-bbb').closest('li')!, { dataTransfer: dtB })
    fireEvent.drop(screen.getByRole('region', { name: 'Blocked' }), { dataTransfer: dtB })

    expect(await screen.findByRole('dialog', { name: 'Move td-bbb' })).toBeInTheDocument()
    expect(screen.queryByDisplayValue('leftover reason meant for td-aaa')).not.toBeInTheDocument()
  })
})
