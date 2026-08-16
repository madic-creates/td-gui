import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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
