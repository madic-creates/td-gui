import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import IssueForm from './IssueForm'

const server = setupServer()
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

  // This form binds title and description only, so a field error naming
  // anything else has no input to render against and must reach the panel.
  it('shows a field error this form does not bind', async () => {
    const message = 'unknown type: epicc'
    server.use(http.post('/v1/issues', () =>
      HttpResponse.json({
        ok: false,
        error: {
          code: 'validation_error',
          message: 'Validation failed',
          details: { fields: [{ field: 'type', rule: 'enum', value: 'epicc', expected: '', message }] },
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
})
