import { describe, expect, it, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import BoardView from './BoardView'
import { makeBoard, makeCard } from './board.fixture'
import type { Board, BoardCard } from '../../api/types'

const urls: string[] = []
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
beforeEach(() => localStorage.clear())
afterEach(() => {
  server.resetHandlers()
  urls.length = 0
})
afterAll(() => server.close())

function renderBoard(board: Board, issues: BoardCard[], path = '/boards/bd-sprint1') {
  server.use(http.get('/v1/boards/:id', ({ request }) => {
    const url = new URL(request.url)
    urls.push(url.pathname + url.search)
    return HttpResponse.json({ ok: true, data: { board, issues } })
  }))
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/boards/:id" element={<BoardView />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BoardView', () => {
  it('shows the board name and its query', async () => {
    renderBoard(makeBoard(), [makeCard({ id: 'td-a1b2' })])
    expect(await screen.findByRole('heading', { name: 'Sprint 1' })).toBeInTheDocument()
    expect(screen.getByText('priority <= P1')).toBeInTheDocument()
  })

  it('starts in the mode td reports and follows the url instead when it says so', async () => {
    renderBoard(makeBoard({ view_mode: 'swimlanes' }), [])
    expect(await screen.findByRole('button', { name: 'Backlog' }))
      .toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Swimlanes' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('remembers the toggled view for this board', async () => {
    renderBoard(makeBoard({ view_mode: 'swimlanes' }), [])
    await userEvent.click(await screen.findByRole('button', { name: 'Backlog' }))
    expect(localStorage.getItem('td-gui.board-view.bd-sprint1')).toBe('backlog')
  })

  it('refetches with include_closed when asked', async () => {
    renderBoard(makeBoard(), [])
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Include closed' }))
    await screen.findByRole('heading', { name: 'Sprint 1' })
    expect(urls).toContain('/v1/boards/bd-sprint1?include_closed=true')
  })

  // td takes the GetBoardIssues path for an empty query and returns only
  // hand-positioned issues — td board show is equally empty. Saying "no
  // issues match" would suggest a query that does not exist.
  it('explains a board that has no query', async () => {
    renderBoard(makeBoard({ query: '' }), [])
    expect(await screen.findByText(/This board has no query/)).toBeInTheDocument()
  })

  it('offers the closed filter when a board with a query matches nothing', async () => {
    renderBoard(makeBoard(), [])
    expect(await screen.findByText('No issues on this board.')).toBeInTheDocument()
  })

  // A query-less board is not necessarily empty: it shows whatever was pinned
  // by hand. The explanation belongs to the empty case only.
  it('renders cards on a board that has no query', async () => {
    renderBoard(makeBoard({ query: '' }), [makeCard({ id: 'td-aaa' })])
    expect(await screen.findByText('td-aaa')).toBeInTheDocument()
    expect(screen.queryByText(/This board has no query/)).not.toBeInTheDocument()
  })

  it("shows td's message when the query fails to execute", async () => {
    server.use(http.get('/v1/boards/:id', () => HttpResponse.json({
      ok: false,
      error: { code: 'internal', message: 'board query error: unknown field "priorityy"' },
    }, { status: 500 })))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/boards/bd-sprint1']}>
          <Routes><Route path="/boards/:id" element={<BoardView />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('alert'))
      .toHaveTextContent('board query error: unknown field "priorityy"')
  })
})
