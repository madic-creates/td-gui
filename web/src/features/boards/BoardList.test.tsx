import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import BoardList from './BoardList'
import { makeBoard } from './board.fixture'
import type { Board } from '../../api/types'

const deleted: string[] = []

const server = setupServer(
  http.delete('/v1/boards/:id', ({ params }) => {
    deleted.push(String(params.id))
    return HttpResponse.json({ ok: true, data: { deleted: true } })
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  deleted.length = 0
})
afterAll(() => server.close())

function renderList(boards: Board[]) {
  server.use(http.get('/v1/boards', () =>
    HttpResponse.json({ ok: true, data: { boards } })))
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><BoardList /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BoardList', () => {
  it('links each board and shows its query', async () => {
    renderList([makeBoard()])
    // Exact name: the row also holds an "Edit Sprint 1" link, and a regex
    // would match both and throw on the ambiguity.
    const link = await screen.findByRole('link', { name: 'Sprint 1' })
    expect(link).toHaveAttribute('href', '/boards/bd-sprint1')
    expect(screen.getByText('priority <= P1')).toBeInTheDocument()
  })

  // td rejects both with 403, so offering the control would be a dead end.
  it('offers no edit and no delete control on a builtin board', async () => {
    renderList([makeBoard({ id: 'bd-all-issues', name: 'All Issues', query: '', is_builtin: true })])
    expect(await screen.findByText('builtin')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Edit/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument()
  })

  it('deletes a board after confirmation', async () => {
    renderList([makeBoard()])
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Sprint 1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(deleted).toEqual(['bd-sprint1'])
  })

  it('invites creating a board when there are none', async () => {
    renderList([])
    expect(await screen.findByText('No boards yet.')).toBeInTheDocument()
  })

  // A board with no query shows only hand-positioned issues, so saying "all"
  // where td shows nothing would be the GUI inventing a second truth.
  it('marks a board that has no query', async () => {
    renderList([makeBoard({ query: '' })])
    expect(await screen.findByText('no query')).toBeInTheDocument()
  })
})
