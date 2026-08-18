import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setupServer } from 'msw/node'
import { delay, http, HttpResponse } from 'msw'
import CommentForm from './CommentForm'
import { expectAnnouncedAtItsInput } from '../../testing/fieldError'

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
    await expectAnnouncedAtItsInput(message)
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

  // The Add comment button disables on add.isPending, but that reads from
  // state and doesn't stop the form's native submit event — two submits
  // landing before a render commits would otherwise both read isPending as
  // false and each post the comment. Same shape as IssueForm.tsx had.
  it('posts only one comment when the form is submitted twice in a row', async () => {
    let count = 0
    server.use(http.post('/v1/issues/td-6a0883/comments', async () => {
      count += 1
      await delay(20)
      return HttpResponse.json({ ok: true, data: {} })
    }))

    renderForm()
    await userEvent.type(screen.getByLabelText('Comment'), 'A remark')
    const form = screen.getByRole('button', { name: 'Add comment' }).closest('form')!

    fireEvent.submit(form)
    fireEvent.submit(form)

    await expect.poll(() => count).toBe(1)
  })
})

it('tells the author that a comment takes GFM', () => {
  renderForm()

  const textarea = screen.getByLabelText('Comment')
  const hintId = textarea.getAttribute('aria-describedby')
  expect(hintId).toBeTruthy()
  expect(document.getElementById(hintId!)).toHaveTextContent(/GitHub Flavored Markdown/)
})
