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

function renderSwimlanes(cards: BoardCard[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><SwimlaneView cards={cards} /></MemoryRouter>
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

  it('shows the closed column only when a closed card is on the board', () => {
    renderSwimlanes([makeCard({ id: 'td-aaa', status: 'open' })])
    expect(screen.queryByRole('region', { name: 'Closed' })).not.toBeInTheDocument()
  })

  it('shows the closed column once a closed card is included', () => {
    renderSwimlanes([
      makeCard({ id: 'td-aaa', status: 'open' }),
      makeCard({ id: 'td-zzz', status: 'closed' }),
    ])
    expect(screen.getByRole('region', { name: 'Closed' })).toHaveTextContent('td-zzz')
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
})
