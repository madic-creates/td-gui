import { describe, expect, it, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setupServer } from 'msw/node'
import { http, HttpResponse, delay } from 'msw'
import IssueEditForm, { boundFields } from './IssueEditForm'
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
  http.get('/v1/issues', () => HttpResponse.json({
    ok: true, data: { issues: [], limit: 1000, offset: 0, total: 0, has_more: false },
  })),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderForm(onDone = vi.fn()) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const tree = (next: Issue, editing: boolean) => (
    <QueryClientProvider client={qc}>
      <IssueEditForm issue={next} editing={editing} onDone={onDone}>
        {/* Stands in for the tag row and action bar the detail view nests
            between the title and the fields. */}
        <p>action bar stand-in</p>
      </IssueEditForm>
    </QueryClientProvider>
  )
  const { rerender } = render(tree(issue, true))
  return {
    onDone,
    // Re-renders the open form with a changed issue prop — what a refetch does.
    refetch: (next: Issue) => rerender(tree(next, true)),
    // The form stays mounted when the editor closes, so open and close are
    // prop changes rather than a mount and an unmount.
    setEditing: (editing: boolean, next: Issue = issue) => rerender(tree(next, editing)),
  }
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

  // The Save button disables on update.isPending, but that reads from state
  // and doesn't stop the form's native submit event — two submits landing
  // before a render commits would otherwise both read isPending as false and
  // each fire a PATCH. Same shape as the double-submit IssueForm.tsx had.
  it('sends only one PATCH when the form is submitted twice in a row', async () => {
    let count = 0
    server.use(http.patch('/v1/issues/td-6a0883', async () => {
      count += 1
      await delay(20)
      return HttpResponse.json({ ok: true, data: { issue } })
    }))
    renderForm()

    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'A brand new title for it')
    const form = screen.getByRole('button', { name: 'Save changes' }).closest('form')!

    fireEvent.submit(form)
    fireEvent.submit(form)

    await waitFor(() => expect(count).toBe(1))
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
    const { onDone } = renderForm()

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

  // The draft is seeded once; the diff must use the issue from that same
  // moment. Diffing against the live prop turns another session's background
  // change into a field the user never touched — and overwrites it with the
  // stale text the draft still holds.
  it('ignores a background change to a field the user never touched', async () => {
    let body: unknown
    server.use(http.patch('/v1/issues/td-6a0883', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ ok: true, data: { issue } })
    }))
    const { refetch } = renderForm()

    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'A brand new title for it')

    refetch({ ...issue, description: 'Rewritten by a concurrent session' })

    // The draft stays put — that part already worked.
    expect(screen.getByLabelText('Description')).toHaveValue('A description')

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(body).toEqual({ title: 'A brand new title for it' }))
  })

  // fetch rejects with a TypeError on a dropped connection, which never
  // reaches ApiError. Without a fallback the form just re-enables Save and
  // says nothing at all.
  it('shows a transport failure that never became an ApiError', async () => {
    server.use(http.patch('/v1/issues/td-6a0883', () => HttpResponse.error()))
    renderForm()

    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'Something long enough here')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Update rejected')).toBeInTheDocument()
  })

  // `minor` is the one editable field with no <FieldError> of its own, so a
  // field error naming it — like any field td renames later — has nowhere to
  // bind and must fall through to the panel.
  it('shows a field error for a field the form does not bind', async () => {
    server.use(http.patch('/v1/issues/td-6a0883', () =>
      HttpResponse.json({
        ok: false,
        error: {
          code: 'validation_error', message: 'Validation failed',
          details: { fields: [{ field: 'minor', rule: 'invalid', message: 'minor cannot be set on an epic' }] },
        },
      }, { status: 400 })))
    renderForm()

    await userEvent.click(screen.getByLabelText('Minor — self-reviewable'))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('minor cannot be set on an epic')).toBeInTheDocument()
  })

  // Closed, the form is just the heading: it stays mounted only so that the
  // action bar it wraps keeps its position in the tree.
  it('renders the title as a heading while the editor is closed', () => {
    const { setEditing } = renderForm()

    setEditing(false)

    expect(screen.getByRole('heading', { name: 'Probe issue for API shape' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  // Seeding happens when the editor opens, not when the component mounts —
  // the component now outlives a single editing session, and an abandoned
  // draft must not come back the next time the editor is opened.
  it('re-seeds the draft each time the editor is opened', async () => {
    const { setEditing } = renderForm()

    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'Edited but abandoned title')

    setEditing(false)
    setEditing(true, { ...issue, title: 'Renamed by another session' })

    expect(screen.getByLabelText('Title')).toHaveValue('Renamed by another session')
  })

  it('drops a rejected save when the editor is closed and reopened', async () => {
    server.use(http.patch('/v1/issues/td-6a0883', () =>
      HttpResponse.json({
        ok: false,
        error: {
          code: 'validation_error', message: 'Validation failed',
          details: { fields: [{ field: 'title', rule: 'min_length', message: 'title too short (2 chars, min 15)' }] },
        },
      }, { status: 400 })))
    const { setEditing } = renderForm()

    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'ab')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('title too short (2 chars, min 15)')).toBeInTheDocument()

    setEditing(false)
    setEditing(true)

    await waitFor(() =>
      expect(screen.queryByText('title too short (2 chars, min 15)')).not.toBeInTheDocument())
  })

  // Resetting a still-pending mutation on close detaches its onSettled
  // callback, which is what clears `submitting` after a save. Without also
  // clearing the ref directly on close, this left Save permanently inert:
  // the next click would see a stale `submitting.current === true` and
  // silently do nothing, forever.
  it('lets Save fire again after the editor is closed while a save is still pending', async () => {
    let count = 0
    server.use(http.patch('/v1/issues/td-6a0883', async () => {
      count += 1
      await delay(50)
      return HttpResponse.json({ ok: true, data: { issue } })
    }))
    const { setEditing } = renderForm()

    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'A brand new title for it')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    // The PATCH above is still in flight when the editor closes and reopens.
    setEditing(false)
    setEditing(true)

    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'A second edit after reopening')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(count).toBe(2))
  })

  it('cancels without sending anything', async () => {
    const { onDone } = renderForm()

    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'Edited but abandoned title')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onDone).toHaveBeenCalledOnce()
  })

  it('patches parent_id with the id of a parent picked by title', async () => {
    server.use(http.get('/v1/issues', () => HttpResponse.json({
      ok: true,
      data: {
        issues: [{ ...issue, id: 'td-epic01', title: 'The containing epic', type: 'epic' }],
        limit: 1000, offset: 0, total: 1, has_more: false,
      },
    })))
    let body: unknown
    server.use(http.patch('/v1/issues/td-6a0883', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ ok: true, data: { issue } })
    }))
    renderForm()

    await userEvent.click(screen.getByLabelText('Parent'))
    await userEvent.click(await screen.findByText('The containing epic'))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(body).toEqual({ parent_id: 'td-epic01' }))
  })

  // An issue cannot be its own parent, so it is not on offer.
  it('does not offer the issue itself as its own parent', async () => {
    server.use(http.get('/v1/issues', () => HttpResponse.json({
      ok: true,
      data: {
        issues: [issue, { ...issue, id: 'td-other', title: 'Some other issue' }],
        limit: 1000, offset: 0, total: 2, has_more: false,
      },
    })))
    renderForm()

    await userEvent.click(screen.getByLabelText('Parent'))

    // Scoped to the listbox: unlike DependencyPanel, this form also has Type
    // and Priority <select> elements, whose <option> children carry the same
    // implicit "option" role and would otherwise collide with the query.
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getByRole('option')).toHaveTextContent('Some other issue')
    expect(within(listbox).getAllByRole('option')).toHaveLength(1)
  })

  // An issue's own child cannot become its parent either — that edge is a
  // cycle just as direct as the self-parent case above, and offering it would
  // only earn a rejection from td.
  it('does not offer the issue\'s own child as its parent', async () => {
    server.use(http.get('/v1/issues', () => HttpResponse.json({
      ok: true,
      data: {
        issues: [
          { ...issue, id: 'td-child01', title: 'A child of this issue', parent_id: issue.id },
          { ...issue, id: 'td-other', title: 'Some other issue' },
        ],
        limit: 1000, offset: 0, total: 2, has_more: false,
      },
    })))
    renderForm()

    await userEvent.click(screen.getByLabelText('Parent'))

    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getByRole('option')).toHaveTextContent('Some other issue')
    expect(within(listbox).getAllByRole('option')).toHaveLength(1)
  })

  it('still clears the parent when the field is emptied', async () => {
    let body: unknown
    server.use(http.patch('/v1/issues/td-6a0883', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ ok: true, data: { issue } })
    }))
    const parented = { ...issue, parent_id: 'td-epic01' }
    const { setEditing } = renderForm()
    // The draft is seeded when the editor opens, not on every re-render, so
    // the issue has to arrive through a close and a re-open to reach the form.
    setEditing(false)
    setEditing(true, parented)

    await userEvent.clear(screen.getByLabelText('Parent'))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(body).toEqual({ parent_id: '' }))
  })

  // Enter is how a form is saved. The combobox has to leave it alone while no
  // suggestion is active, or clearing the parent and pressing Enter refills
  // the field with whichever issue happens to be first in the index.
  it('clears the parent on Enter rather than picking a suggestion', async () => {
    server.use(http.get('/v1/issues', () => HttpResponse.json({
      ok: true,
      data: {
        issues: [{ ...issue, id: 'td-epic01', title: 'The containing epic', type: 'epic' }],
        limit: 1000, offset: 0, total: 1, has_more: false,
      },
    })))
    let body: unknown
    server.use(http.patch('/v1/issues/td-6a0883', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ ok: true, data: { issue } })
    }))
    const parented = { ...issue, parent_id: 'td-epic01' }
    const { setEditing } = renderForm()
    setEditing(false)
    setEditing(true, parented)

    await userEvent.clear(screen.getByLabelText('Parent'))
    await userEvent.keyboard('{Enter}')

    await waitFor(() => expect(body).toEqual({ parent_id: '' }))
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
describe('IssueEditForm bound fields', () => {
  it.each(boundFields)('renders td\'s message for %s at its own input', async field => {
    const message = `${field} is not acceptable`
    server.use(http.patch('/v1/issues/td-6a0883', () =>
      HttpResponse.json({
        ok: false,
        error: {
          code: 'validation_error', message: 'Validation failed',
          details: { fields: [{ field, rule: 'invalid', message }] },
        },
      }, { status: 400 })))
    renderForm()

    // Any edit will do — the point is to get a rejected PATCH back.
    await userEvent.type(screen.getByLabelText('Title'), ' edited')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findAllByText(message)).toHaveLength(1)
  })

  // The counterpart: `minor` is the one editable field with no FieldError of
  // its own, so its message has to fall through to the panel.
  it('sends a message for an unbound field to the panel', async () => {
    const message = 'minor cannot be set on an epic'
    server.use(http.patch('/v1/issues/td-6a0883', () =>
      HttpResponse.json({
        ok: false,
        error: {
          code: 'validation_error', message: 'Validation failed',
          details: { fields: [{ field: 'minor', rule: 'invalid', message }] },
        },
      }, { status: 400 })))
    renderForm()

    await userEvent.type(screen.getByLabelText('Title'), ' edited')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findAllByText(message)).toHaveLength(1)
  })
})
