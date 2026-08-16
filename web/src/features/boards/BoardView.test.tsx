import { describe, expect, it, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import BoardView from './BoardView'
import { makeBoard, makeCard } from './board.fixture'
import { storeView } from './viewMode'
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

  it('starts in the mode td reports when there is no url and no stored preference', async () => {
    renderBoard(makeBoard({ view_mode: 'swimlanes' }), [])
    expect(await screen.findByRole('button', { name: 'Backlog' }))
      .toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Swimlanes' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  // The url must win even when it disagrees with both the stored preference
  // and what td reports — otherwise a shared link with ?view=... would be
  // silently overridden by whichever of the other two happens to apply.
  it('prefers the url over both the stored preference and td', async () => {
    storeView('bd-sprint1', 'backlog')
    renderBoard(makeBoard({ view_mode: 'backlog' }), [], '/boards/bd-sprint1?view=swimlanes')
    expect(await screen.findByRole('button', { name: 'Swimlanes' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Backlog' }))
      .toHaveAttribute('aria-pressed', 'false')
  })

  // This is the leg a url -> td -> stored order would get wrong: with no url
  // present, the stored preference must still outrank td's own view_mode.
  it('prefers the stored preference over td when there is no url', async () => {
    storeView('bd-sprint1', 'swimlanes')
    renderBoard(makeBoard({ view_mode: 'backlog' }), [])
    expect(await screen.findByRole('button', { name: 'Swimlanes' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Backlog' }))
      .toHaveAttribute('aria-pressed', 'false')
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

  // An empty query matches every issue — verified against td v0.57.0, where
  // both a hand-made query-less board and the built-in "All Issues" return the
  // whole project. So an empty one means the project is empty, and saying "no
  // issues match" would suggest a query that does not exist.
  it('explains a board that has no query', async () => {
    renderBoard(makeBoard({ query: '' }), [])
    expect(await screen.findByText('No issues yet.')).toBeInTheDocument()
    // Nothing here is the query's doing, so the hint must not send the user to
    // edit it — nor to td board move, which pins a card rather than making one.
    expect(screen.getByText(/every issue in the project/)).toBeInTheDocument()
    expect(screen.queryByText(/td board move/)).not.toBeInTheDocument()
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
