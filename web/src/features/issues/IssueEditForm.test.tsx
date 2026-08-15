import { describe, expect, it, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import IssueEditForm from './IssueEditForm'
import type { Issue } from '../../api/types'

const issue: Issue = {
  id: 'td-6a0883', title: 'Probe issue for API shape', description: 'A description',
  status: 'open', type: 'feature', priority: 'P1', points: 5, labels: ['alpha'],
  parent_id: null, acceptance: '', sprint: '', implementer_session: null,
  creator_session: null, reviewer_session: null, review_requested_by_session: null,
  closed_by_session: null, created_at: '2026-08-14T15:01:46+02:00',
  updated_at: '2026-08-14T15:04:10+02:00', reviewed_at: null, closed_at: null,
  deleted_at: null, minor: false, created_branch: null, defer_until: null,
  due_date: '2026-09-01', defer_count: 0,
}

const server = setupServer(
  http.get('/v1/labels', () =>
    HttpResponse.json({ ok: true, data: { default_workflow: 'standard', labels: ['alpha'] } })),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderForm(onDone = vi.fn()) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <IssueEditForm issue={issue} onDone={onDone} />
    </QueryClientProvider>,
  )
  return onDone
}

describe('IssueEditForm', () => {
  it('sends only the field that changed', async () => {
    let body: unknown
    server.use(http.patch('/v1/issues/td-6a0883', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ ok: true, data: { issue } })
    }))
    renderForm()

    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'A brand new title for it')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(body).toEqual({ title: 'A brand new title for it' }))
  })

  it('clears a date with an empty string rather than null', async () => {
    let body: unknown
    server.use(http.patch('/v1/issues/td-6a0883', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ ok: true, data: { issue } })
    }))
    renderForm()

    await userEvent.clear(screen.getByLabelText('Due date'))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(body).toEqual({ due_date: '' }))
  })

  it('closes without a request when nothing was edited', async () => {
    // onUnhandledRequest: 'error' turns a stray PATCH into a failure.
    const onDone = renderForm()

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(onDone).toHaveBeenCalledOnce()
  })

  it("shows td's field error verbatim against the field", async () => {
    server.use(http.patch('/v1/issues/td-6a0883', () =>
      HttpResponse.json({
        ok: false,
        error: {
          code: 'validation_error', message: 'Validation failed',
          details: { fields: [{ field: 'title', rule: 'min_length', message: 'title too short (2 chars, min 15)' }] },
        },
      }, { status: 400 })))
    renderForm()

    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'ab')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('title too short (2 chars, min 15)')).toBeInTheDocument()
  })

  // td's JSON type errors are validation_error with no details.fields, so a
  // code check would swallow them. The predicate is "no fields", not "not a
  // validation error".
  it('shows a validation error carrying no fields in the panel', async () => {
    server.use(http.patch('/v1/issues/td-6a0883', () =>
      HttpResponse.json({
        ok: false,
        error: { code: 'validation_error', message: 'invalid JSON: cannot unmarshal string into field points of type int' },
      }, { status: 400 })))
    renderForm()

    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'Something long enough here')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText(/cannot unmarshal string into field points/)).toBeInTheDocument()
  })

  it('cancels without sending anything', async () => {
    const onDone = renderForm()

    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'Edited but abandoned title')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onDone).toHaveBeenCalledOnce()
  })
})
