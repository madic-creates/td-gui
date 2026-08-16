import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import BoardForm from './BoardForm'
import { makeBoard } from './board.fixture'

const sent: unknown[] = []

const server = setupServer(
  http.get('/v1/boards', () =>
    HttpResponse.json({ ok: true, data: { boards: [makeBoard()] } })),
  http.post('/v1/boards', async ({ request }) => {
    sent.push(await request.json())
    return HttpResponse.json(
      { ok: true, data: { board: makeBoard({ id: 'bd-new' }) } }, { status: 201 })
  }),
  http.patch('/v1/boards/:id', async ({ request }) => {
    sent.push(await request.json())
    return HttpResponse.json({ ok: true, data: { board: makeBoard() } })
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  sent.length = 0
})
afterAll(() => server.close())

function renderForm(path: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/boards/new" element={<BoardForm />} />
          <Route path="/boards/:id/edit" element={<BoardForm />} />
          <Route path="/boards/:id" element={<p>board page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BoardForm', () => {
  it('creates a board from a name and a query', async () => {
    renderForm('/boards/new')
    await userEvent.type(screen.getByLabelText('Name'), 'Bugs')
    await userEvent.type(screen.getByLabelText('Query'), 'type = bug')
    await userEvent.click(screen.getByRole('button', { name: 'Create board' }))
    expect(await screen.findByText('board page')).toBeInTheDocument()
    expect(sent).toEqual([{ name: 'Bugs', query: 'type = bug' }])
  })

  it("starts an edit from the board's stored name and query", async () => {
    renderForm('/boards/bd-sprint1/edit')
    expect(await screen.findByLabelText('Name')).toHaveValue('Sprint 1')
    expect(screen.getByLabelText('Query')).toHaveValue('priority <= P1')
  })

  // td parses TDQ and phrases the failure precisely. The frontend must not
  // pre-empt it with a rule of its own, and must show td's wording at the
  // field it names.
  it("shows td's TDQ message on the query field", async () => {
    server.use(http.post('/v1/boards', () => HttpResponse.json({
      ok: false,
      error: {
        code: 'validation_error',
        message: 'validation failed',
        details: { fields: [{
          field: 'query', rule: 'tdq_syntax', value: 'priorityy <= P1',
          message: 'invalid TDQ query: unknown field "priorityy"',
        }] },
      },
    }, { status: 400 })))

    renderForm('/boards/new')
    await userEvent.type(screen.getByLabelText('Name'), 'Broken')
    await userEvent.type(screen.getByLabelText('Query'), 'priorityy <= P1')
    await userEvent.click(screen.getByRole('button', { name: 'Create board' }))

    expect(await screen.findByText('invalid TDQ query: unknown field "priorityy"'))
      .toBeInTheDocument()
  })

  it('shows an error with no field in the panel', async () => {
    server.use(http.post('/v1/boards', () => HttpResponse.json({
      ok: false, error: { code: 'internal', message: 'failed to create board' },
    }, { status: 500 })))

    renderForm('/boards/new')
    await userEvent.type(screen.getByLabelText('Name'), 'Any')
    await userEvent.click(screen.getByRole('button', { name: 'Create board' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('failed to create board')
  })
})
