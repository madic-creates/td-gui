import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
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
      <MemoryRouter><IssueForm /></MemoryRouter>
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

  it('sends the entered values on success', async () => {
    let received: { title?: string; priority?: string } | null = null
    server.use(http.post('/v1/issues', async ({ request }) => {
      received = await request.json() as { title?: string; priority?: string }
      return HttpResponse.json({ ok: true, data: { issue: { id: 'td-new' } } })
    }))

    renderForm()
    await userEvent.type(screen.getByLabelText('Title'), 'A sufficiently long issue title')
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'P1')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await screen.findByText(/created/i)
    expect(received!.title).toBe('A sufficiently long issue title')
    expect(received!.priority).toBe('P1')
  })
})
