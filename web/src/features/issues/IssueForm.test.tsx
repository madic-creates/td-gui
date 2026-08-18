import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse, delay } from 'msw'
import IssueForm from './IssueForm'
import { boundFields } from './IssueFields'

const server = setupServer(
  http.get('/v1/labels', () =>
    HttpResponse.json({ ok: true, data: { default_workflow: 'standard', labels: ['alpha'] } })),
  http.get('/v1/issues', () => HttpResponse.json({
    ok: true, data: { issues: [], limit: 1000, offset: 0, total: 0, has_more: false },
  })),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/new']}>
        <Routes>
          <Route path="/new" element={<IssueForm />} />
          {/* A stand-in for the detail route, so a create's navigate lands
              somewhere distinguishable — proving navigation actually fired
              with the server's id, not just that the POST went out. */}
          <Route path="/issues/:id" element={<p>issue detail stand-in</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('IssueForm', () => {
  // The client must not pre-validate length: td's minimum is per-project
  // config (15 in a fresh project, 3 by default). Only the server knows.
  it('submits a short title and shows the server field error', async () => {
    let received: unknown = null
    server.use(http.post('/v1/issues', async ({ request }) => {
      received = await request.json()
      return HttpResponse.json({
        ok: false,
        error: {
          code: 'validation_error',
          message: 'Validation failed',
          details: {
            fields: [{
              field: 'title', rule: 'min_length', value: 'ab', expected: 15,
              message: 'title too short (2 chars, min 15)',
            }],
          },
        },
      }, { status: 400 })
    }))

    renderForm()
    await userEvent.type(screen.getByLabelText('Title'), 'ab')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('title too short (2 chars, min 15)')).toBeInTheDocument()
    expect(received).toEqual(expect.objectContaining({ title: 'ab' }))
  })

  // td's JSON type errors arrive as validation_error with no details.fields.
  // The panel used to be guarded by `code !== 'validation_error'`, so these
  // were swallowed whole and the form simply went quiet.
  it("shows td's validation error when it names no field", async () => {
    const message = 'json: cannot unmarshal string into field points of type int'
    server.use(http.post('/v1/issues', () =>
      HttpResponse.json({ ok: false, error: { code: 'validation_error', message } },
        { status: 400 })))

    renderForm()
    await userEvent.type(screen.getByLabelText('Title'), 'A sufficiently long issue title')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  // This form binds every field it renders, so an error naming something
  // else has no input to render against and must reach the panel.
  it('shows a field error this form does not bind', async () => {
    const message = 'unknown status: opne'
    server.use(http.post('/v1/issues', () =>
      HttpResponse.json({
        ok: false,
        error: {
          code: 'validation_error',
          message: 'Validation failed',
          details: { fields: [{ field: 'status', rule: 'enum', value: 'opne', expected: '', message }] },
        },
      }, { status: 400 })))

    renderForm()
    await userEvent.type(screen.getByLabelText('Title'), 'A sufficiently long issue title')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it('sends the entered values and navigates to the new issue on success', async () => {
    let received: { title?: string; priority?: string } | null = null
    server.use(http.post('/v1/issues', async ({ request }) => {
      received = await request.json() as { title?: string; priority?: string }
      return HttpResponse.json({ ok: true, data: { issue: { id: 'td-new' } } })
    }))

    renderForm()
    await userEvent.type(screen.getByLabelText('Title'), 'A sufficiently long issue title')
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'P1')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await screen.findByText('issue detail stand-in')
    expect(received!.title).toBe('A sufficiently long issue title')
    expect(received!.priority).toBe('P1')
  })

  // The Create button disables on isPending, but that's a state update and
  // does not stop the form's native submit event — a second Enter landing
  // before React re-renders the button would otherwise fire a second POST
  // and create a duplicate issue.
  it('does not create a duplicate issue when the form is submitted twice in a row', async () => {
    let count = 0
    server.use(http.post('/v1/issues', async () => {
      count += 1
      await delay(20)
      return HttpResponse.json({ ok: true, data: { issue: { id: 'td-new' } } })
    }))

    renderForm()
    await userEvent.type(screen.getByLabelText('Title'), 'A sufficiently long issue title')
    const form = screen.getByRole('button', { name: 'Create' }).closest('form')!

    fireEvent.submit(form)
    fireEvent.submit(form)

    await screen.findByText('issue detail stand-in')
    expect(count).toBe(1)
  })

  // The quick path this form exists for: a title and nothing else. An empty
  // field must be absent from the body, not sent as "" — td applies its own
  // default to a field the body omits, and stores the blank for one it carries.
  it('posts only the fields the user filled', async () => {
    let received: Record<string, unknown> | null = null
    server.use(http.post('/v1/issues', async ({ request }) => {
      received = await request.json() as Record<string, unknown>
      return HttpResponse.json({ ok: true, data: { issue: { id: 'td-new' } } })
    }))

    renderForm()
    await userEvent.type(screen.getByLabelText('Title'), 'A sufficiently long issue title')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await screen.findByText('issue detail stand-in')
    expect(received).toEqual({
      title: 'A sufficiently long issue title', type: 'task', priority: 'P2',
    })
  })

  it('sends acceptance, points and sprint in the create body', async () => {
    let received: Record<string, unknown> | null = null
    server.use(http.post('/v1/issues', async ({ request }) => {
      received = await request.json() as Record<string, unknown>
      return HttpResponse.json({ ok: true, data: { issue: { id: 'td-new' } } })
    }))

    renderForm()
    await userEvent.type(screen.getByLabelText('Title'), 'A sufficiently long issue title')
    await userEvent.type(screen.getByLabelText('Acceptance criteria'), 'it works')
    await userEvent.type(screen.getByLabelText('Points'), '5')
    await userEvent.type(screen.getByLabelText('Sprint'), 'sprint-1')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await screen.findByText('issue detail stand-in')
    expect(received).toEqual(expect.objectContaining({
      acceptance: 'it works', points: 5, sprint: 'sprint-1',
    }))
  })

  // The accepted point values are per-project td config, and td names them in
  // the error when it rejects one. A min or max here would eventually be wrong.
  it('puts no bounds on the points input', () => {
    renderForm()
    const points = screen.getByLabelText('Points')
    expect(points).not.toHaveAttribute('min')
    expect(points).not.toHaveAttribute('max')
  })

  // A field with a FieldError of its own must render td's message there and
  // not in the panel — the panel is for what nothing on screen has claimed.
  it('renders a points error at the points input', async () => {
    const message = 'invalid points: 4 (allowed: 1, 2, 3, 5, 8)'
    server.use(http.post('/v1/issues', () =>
      HttpResponse.json({
        ok: false,
        error: {
          code: 'validation_error',
          message: 'Validation failed',
          details: { fields: [{ field: 'points', rule: 'enum', value: 4, expected: '', message }] },
        },
      }, { status: 400 })))

    renderForm()
    await userEvent.type(screen.getByLabelText('Title'), 'A sufficiently long issue title')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findAllByText(message)).toHaveLength(1)
  })

  it('sends labels, parent, both dates and minor in the create body', async () => {
    let received: Record<string, unknown> | null = null
    server.use(http.post('/v1/issues', async ({ request }) => {
      received = await request.json() as Record<string, unknown>
      return HttpResponse.json({ ok: true, data: { issue: { id: 'td-new' } } })
    }))

    renderForm()
    await userEvent.type(screen.getByLabelText('Title'), 'A sufficiently long issue title')
    await userEvent.type(screen.getByLabelText('Labels'), 'alpha')
    await userEvent.click(screen.getByRole('button', { name: 'Add label' }))
    await userEvent.type(screen.getByLabelText('Parent'), 'td-a1b2c3')
    // fireEvent, not userEvent.type: a date input takes a whole value, and
    // typing into one keystroke by keystroke does not produce a valid date.
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('Defer until'), { target: { value: '2026-08-20' } })
    await userEvent.click(screen.getByLabelText('Minor — self-reviewable'))
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await screen.findByText('issue detail stand-in')
    expect(received).toEqual(expect.objectContaining({
      labels: ['alpha'], parent_id: 'td-a1b2c3',
      due_date: '2026-09-01', defer_until: '2026-08-20', minor: true,
    }))
  })
})

// td returns not_found for a parent that does not exist, and — unlike its
// validation errors — that carries no details.fields. There is no input for
// it to bind to, so the panel is the only place it can be seen at all.
describe('IssueForm unbound errors', () => {
  it('renders a parent not_found in the panel', async () => {
    const message = 'parent issue not found: td-zzzzzz'
    server.use(http.post('/v1/issues', () =>
      HttpResponse.json({ ok: false, error: { code: 'not_found', message } },
        { status: 404 })))

    renderForm()
    await userEvent.type(screen.getByLabelText('Title'), 'A sufficiently long issue title')
    await userEvent.type(screen.getByLabelText('Parent'), 'td-zzzzzz')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findAllByText(message)).toHaveLength(1)
  })
})

/**
 * `boundFields` tells the panel which messages are already on screen, so a
 * name that no input actually renders re-creates the silence the shared
 * predicate exists to end. It is hand-maintained and cannot be derived — the
 * panel's value is computed during the parent's render, before any child
 * FieldError has run — so it is pinned here instead.
 *
 * Exactly once is the whole assertion, and it catches both directions: a stale
 * entry renders the message nowhere (0), and a field left off the list renders
 * it at the input and again in the panel (2).
 */
describe('IssueForm bound fields', () => {
  it.each(boundFields)('renders td\'s message for %s at its own input', async field => {
    const message = `${field} is not acceptable`
    server.use(http.post('/v1/issues', () =>
      HttpResponse.json({
        ok: false,
        error: {
          code: 'validation_error',
          message: 'Validation failed',
          details: { fields: [{ field, rule: 'invalid', value: '', expected: '', message }] },
        },
      }, { status: 400 })))

    renderForm()
    await userEvent.type(screen.getByLabelText('Title'), 'A sufficiently long issue title')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findAllByText(message)).toHaveLength(1)
  })

  it('tells the author that description and acceptance take GFM', async () => {
    renderForm()

    const description = await screen.findByLabelText('Description')
    const acceptance = screen.getByLabelText('Acceptance criteria')

    for (const field of [description, acceptance]) {
      const hintId = field.getAttribute('aria-describedby')
      expect(hintId).toBeTruthy()
      const hint = document.getElementById(hintId!)
      expect(hint).toHaveTextContent(/GitHub Flavored Markdown/)
    }
  })

})
