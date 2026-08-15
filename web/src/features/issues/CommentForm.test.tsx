import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import CommentForm from './CommentForm'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderForm() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <CommentForm issueId="td-6a0883" />
    </QueryClientProvider>,
  )
}

async function submit(text: string) {
  renderForm()
  await userEvent.type(screen.getByLabelText('Comment'), text)
  await userEvent.click(screen.getByRole('button', { name: 'Add comment' }))
}

describe('CommentForm', () => {
  it('posts the comment as `text`', async () => {
    let body: unknown
    server.use(http.post('/v1/issues/td-6a0883/comments', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ ok: true, data: {} })
    }))

    await submit('A remark')
    await expect.poll(() => body).toEqual({ text: 'A remark' })
  })

  // The one field this form binds keeps its message at the textarea.
  it("shows td's message for the text field once, at the field", async () => {
    const message = 'comment text is required'
    server.use(http.post('/v1/issues/td-6a0883/comments', () =>
      HttpResponse.json({
        ok: false,
        error: {
          code: 'validation_error',
          message: 'Validation failed',
          details: { fields: [{ field: 'text', rule: 'required', value: '', expected: '', message }] },
        },
      }, { status: 400 })))

    await submit('x')
    expect(await screen.findAllByText(message)).toHaveLength(1)
  })

  // Swallowed entirely by the old `code !== 'validation_error'` guard: td's
  // JSON type errors carry no details.fields, so neither branch rendered them.
  it("shows td's validation error when it names no field", async () => {
    const message = 'json: cannot unmarshal number into field text of type string'
    server.use(http.post('/v1/issues/td-6a0883/comments', () =>
      HttpResponse.json({ ok: false, error: { code: 'validation_error', message } },
        { status: 400 })))

    await submit('x')
    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it("shows td's rejection verbatim when it is not a validation error", async () => {
    const message = 'issue not found: td-6a0883'
    server.use(http.post('/v1/issues/td-6a0883/comments', () =>
      HttpResponse.json({ ok: false, error: { code: 'not_found', message } },
        { status: 404 })))

    await submit('x')
    expect(await screen.findByText(message)).toBeInTheDocument()
  })
})
