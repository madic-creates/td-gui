import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import BoardForm from './BoardForm'
import { makeBoard } from './board.fixture'

const sent: unknown[] = []
/** Which board each PATCH addressed: the msw route matches any id. */
const patched: string[] = []

const server = setupServer(
  http.get('/v1/boards', () =>
    HttpResponse.json({ ok: true, data: { boards: [makeBoard()] } })),
  http.post('/v1/boards', async ({ request }) => {
    sent.push(await request.json())
    return HttpResponse.json(
      { ok: true, data: { board: makeBoard({ id: 'bd-new' }) } }, { status: 201 })
  }),
  http.patch('/v1/boards/:id', async ({ request, params }) => {
    sent.push(await request.json())
    patched.push(String(params.id))
    return HttpResponse.json({ ok: true, data: { board: makeBoard() } })
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  sent.length = 0
  patched.length = 0
})
afterAll(() => server.close())

/**
 * Stands in for BoardView and names the board it was reached with, so a submit
 * that navigated to the wrong id fails instead of landing on an anonymous page
 * that looks the same wherever it came from.
 */
function LandedOn() {
  const { id } = useParams()
  return <p>board page {id}</p>
}

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
          <Route path="/boards/:id" element={<LandedOn />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BoardForm', () => {
  // A create has no id to navigate with until td answers, so the destination
  // is the one in the response — bd-new, not the bd-sprint1 the board list
  // happens to hold.
  it('creates a board from a name and a query', async () => {
    renderForm('/boards/new')
    await userEvent.type(screen.getByLabelText('Name'), 'Bugs')
    await userEvent.type(screen.getByLabelText('Query'), 'type = bug')
    await userEvent.click(screen.getByRole('button', { name: 'Create board' }))
    expect(await screen.findByText('board page bd-new')).toBeInTheDocument()
    expect(sent).toEqual([{ name: 'Bugs', query: 'type = bug' }])
  })

  it("starts an edit from the board's stored name and query", async () => {
    renderForm('/boards/bd-sprint1/edit')
    expect(await screen.findByLabelText('Name')).toHaveValue('Sprint 1')
    expect(screen.getByLabelText('Query')).toHaveValue('priority <= P1')
  })

  // The other half of the edit path: the create submit is covered above, and
  // this one differs in all three of the things that can go wrong — PATCH
  // rather than POST, both fields sent even though only one was touched, and
  // a destination taken from the board being edited rather than the response.
  it('saves an edit and returns to the board', async () => {
    renderForm('/boards/bd-sprint1/edit')
    const name = await screen.findByLabelText('Name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Sprint 2')
    await userEvent.click(screen.getByRole('button', { name: 'Save board' }))

    expect(await screen.findByText('board page bd-sprint1')).toBeInTheDocument()
    expect(sent).toEqual([{ name: 'Sprint 2', query: 'priority <= P1' }])
    expect(patched).toEqual(['bd-sprint1'])
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
