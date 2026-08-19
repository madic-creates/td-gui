import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import SavedQueryBar from './SavedQueryBar'
import { makeBoard } from '../boards/board.fixture'
import { expectAnnouncedAtItsInput } from '../../testing/fieldError'

const sent: unknown[] = []
/** Which board each PATCH addressed: the msw route matches any id. */
const patched: string[] = []

const boards = [
  makeBoard(),
  makeBoard({ id: 'bd-bugs', name: 'Bugs', query: 'type = bug AND priority <= P1' }),
  makeBoard({ id: 'bd-all', name: 'All Issues', query: '', is_builtin: true }),
]

const server = setupServer(
  http.get('/v1/boards', () => HttpResponse.json({ ok: true, data: { boards } })),
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

function renderBar(props: Partial<React.ComponentProps<typeof SavedQueryBar>> = {}) {
  const onPick = props.onPick ?? vi.fn()
  const onSaved = props.onSaved ?? vi.fn()
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SavedQueryBar query={undefined} {...props} onPick={onPick} onSaved={onSaved} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { onPick, onSaved }
}

const openMenu = () => userEvent.click(screen.getByRole('button', { name: 'Saved queries' }))

describe('picking a saved query', () => {
  it('lists each board by name and query', async () => {
    renderBar()
    await openMenu()

    expect(await screen.findByText('Sprint 1')).toBeInTheDocument()
    expect(screen.getByText('priority <= P1')).toBeInTheDocument()
    expect(screen.getByText('Bugs')).toBeInTheDocument()
  })

  it('leaves out a board with an empty query, whose emptiness means something else', async () => {
    renderBar()
    await openMenu()

    // On a board an empty query means "only the cards placed by hand", and on
    // the builtin it means the whole project. In the search box it would mean
    // every issue, which is neither.
    expect(await screen.findByText('Sprint 1')).toBeInTheDocument()
    expect(screen.queryByText('All Issues')).not.toBeInTheDocument()
  })

  it('reports the query and the board it came from', async () => {
    const { onPick } = renderBar()
    await openMenu()
    await userEvent.click(await screen.findByRole('menuitem', { name: /Bugs/ }))

    expect(onPick).toHaveBeenCalledWith('type = bug AND priority <= P1', 'bd-bugs')
  })

  it('closes the menu once a query has been picked', async () => {
    renderBar()
    await openMenu()
    await userEvent.click(await screen.findByRole('menuitem', { name: /Bugs/ }))

    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })

  it('can be reached while the box is empty, which is where a saved query is wanted', async () => {
    renderBar({ query: undefined })

    expect(screen.getByRole('button', { name: 'Saved queries' })).toBeInTheDocument()
  })
})

describe('saving a query that came from nowhere', () => {
  it('offers to save the query that is running', () => {
    renderBar({ query: 'type = bug' })

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('offers nothing to save while there is no query at all', () => {
    renderBar({ query: undefined })

    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('posts the name and the running query, and reports the new board', async () => {
    const { onSaved } = renderBar({ query: 'type = bug' })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await userEvent.type(screen.getByLabelText('Board name'), 'Bugs')
    await userEvent.click(screen.getByRole('button', { name: 'Save board' }))

    await vi.waitFor(() => expect(sent).toEqual([{ name: 'Bugs', query: 'type = bug' }]))
    expect(onSaved).toHaveBeenCalledWith('bd-new')
  })

  it("shows td's own words for a name it rejects, under the field", async () => {
    server.use(http.post('/v1/boards', () => HttpResponse.json(
      {
        ok: false,
        error: {
          code: 'validation_error',
          message: 'invalid board',
          details: { fields: [{ field: 'name', message: 'name too short (2 chars, min 3)' }] },
        },
      },
      { status: 400 },
    )))
    renderBar({ query: 'type = bug' })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await userEvent.type(screen.getByLabelText('Board name'), 'ab')
    await userEvent.click(screen.getByRole('button', { name: 'Save board' }))

    await expectAnnouncedAtItsInput('name too short (2 chars, min 3)')
  })
})

describe('a query loaded from a board', () => {
  it('offers nothing to save while it still is what the board holds', async () => {
    renderBar({ query: 'priority <= P1', board: 'bd-sprint1' })
    // Opening the menu waits for the board list, so this is an absence after
    // the answer arrived rather than before it.
    await openMenu()
    await screen.findByRole('menuitem', { name: /Sprint 1/ })

    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save as new' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Update/ })).not.toBeInTheDocument()
  })

  it('offers nothing while the board list has not arrived, rather than "Save"', () => {
    renderBar({ query: 'priority <= P1', board: 'bd-sprint1' })

    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('offers to write a changed query back to its board', async () => {
    renderBar({ query: 'priority <= P0', board: 'bd-sprint1' })

    expect(await screen.findByRole('button', { name: 'Update "Sprint 1"' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save as new' })).toBeInTheDocument()
  })

  it("patches that board with its own name and the query on screen", async () => {
    renderBar({ query: 'priority <= P0', board: 'bd-sprint1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Update "Sprint 1"' }))

    await vi.waitFor(() => expect(patched).toEqual(['bd-sprint1']))
    expect(sent).toEqual([{ name: 'Sprint 1', query: 'priority <= P0' }])
  })

  it('treats an id no board answers to as no board at all', async () => {
    renderBar({ query: 'type = bug', board: 'bd-deleted' })

    // The board was deleted in another tab. That costs the reader an offer to
    // save the query again, not an error.
    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Update/ })).not.toBeInTheDocument()
  })
})
