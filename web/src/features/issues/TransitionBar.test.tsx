import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setupServer } from 'msw/node'
import { delay, http, HttpResponse } from 'msw'
import TransitionBar from './TransitionBar'
import type { Transition } from '../../api/types'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderBar(available: Transition[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <TransitionBar issueId="td-6a0883" available={available} />
    </QueryClientProvider>,
  )
}

/** Captures the JSON body of the next matching request. */
function captureBody(method: 'post', path: string) {
  const seen: { body: unknown } = { body: undefined }
  const handler = http[method](path, async ({ request }) => {
    seen.body = await request.json()
    return HttpResponse.json({ ok: true, data: {} })
  })
  return { seen, handler }
}

describe('TransitionBar reasons', () => {
  it('sends the typed reason with a reject', async () => {
    const { seen, handler } = captureBody('post', '/v1/issues/td-6a0883/reject')
    server.use(handler)

    renderBar(['reject'])
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await userEvent.type(screen.getByLabelText('Reason'), 'Missing error handling')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm reject' }))

    await expect.poll(() => seen.body).toEqual({ reason: 'Missing error handling' })
  })

  it.each(['block', 'close'] as const)('sends the typed reason with a %s', async action => {
    const { seen, handler } = captureBody('post', `/v1/issues/td-6a0883/${action}`)
    server.use(handler)
    const label = action === 'block' ? 'Block' : 'Close'

    renderBar([action])
    await userEvent.click(screen.getByRole('button', { name: label }))
    await userEvent.type(screen.getByLabelText('Reason'), 'because')
    await userEvent.click(screen.getByRole('button', { name: `Confirm ${action}` }))

    await expect.poll(() => seen.body).toEqual({ reason: 'because' })
  })

  // The reason is optional on these — an empty box must not send `reason: ""`,
  // which td would otherwise log as an empty progress entry.
  it('omits the reason when the box is left empty', async () => {
    const { seen, handler } = captureBody('post', '/v1/issues/td-6a0883/block')
    server.use(handler)

    renderBar(['block'])
    await userEvent.click(screen.getByRole('button', { name: 'Block' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm block' }))

    await expect.poll(() => seen.body).toEqual({})
  })

  // Transitions td takes no note for still fire on the first click.
  it('fires start immediately without a form', async () => {
    const { seen, handler } = captureBody('post', '/v1/issues/td-6a0883/start')
    server.use(handler)

    renderBar(['start'])
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))

    await expect.poll(() => seen.body).toEqual({})
    expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument()
  })
})

describe('TransitionBar double submit', () => {
  // The Confirm button disables on `busy` (mutation.isPending), but that
  // reads from state and doesn't stop the form's native submit event — two
  // submits landing before a render commits both read busy as false and
  // both mutate, same shape already fixed in IssueForm/IssueEditForm/
  // CommentForm.
  it('sends only one reject when the reason form is submitted twice in a row', async () => {
    let count = 0
    server.use(http.post('/v1/issues/td-6a0883/reject', async () => {
      count += 1
      await delay(20)
      return HttpResponse.json({ ok: true, data: {} })
    }))

    renderBar(['reject'])
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await userEvent.type(screen.getByLabelText('Reason'), 'needs work')
    const form = screen.getByRole('button', { name: 'Confirm reject' }).closest('form')!

    fireEvent.submit(form)
    fireEvent.submit(form)

    await expect.poll(() => count).toBe(1)
  })
})

describe('TransitionBar approve attribution', () => {
  async function openApprove() {
    renderBar(['approve'])
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
  }

  // An independent reviewer needs neither attribution field — td accepts a
  // bare approve, and a reason is merely optional colour.
  it('sends only the reason for an independent review', async () => {
    const { seen, handler } = captureBody('post', '/v1/issues/td-6a0883/approve')
    server.use(handler)

    await openApprove()
    await userEvent.type(screen.getByLabelText('Reason'), 'Read it end to end')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm approve' }))

    await expect.poll(() => seen.body).toEqual({ reason: 'Read it end to end' })
  })

  it('sends reviewed_by when the review is attributed to someone else', async () => {
    const { seen, handler } = captureBody('post', '/v1/issues/td-6a0883/approve')
    server.use(handler)

    await openApprove()
    await userEvent.click(screen.getByRole('radio', { name: 'Reviewed by someone else' }))
    await userEvent.type(screen.getByLabelText('Reviewer'), 'reviewer sub-agent')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm approve' }))

    await expect.poll(() => seen.body).toEqual({ reviewed_by: 'reviewer sub-agent' })
  })

  // td only rejects reviewed_by when it trims to empty from non-empty input
  // (whitespace-only); a field left untouched arrives as "" and passes that
  // check, so without a client-side guard "Reviewed by someone else" with a
  // blank name would silently record an unattributed approval.
  it('disables confirm when "Reviewed by someone else" is chosen but left blank', async () => {
    const { seen, handler } = captureBody('post', '/v1/issues/td-6a0883/approve')
    server.use(handler)

    await openApprove()
    await userEvent.click(screen.getByRole('radio', { name: 'Reviewed by someone else' }))
    expect(screen.getByRole('button', { name: 'Confirm approve' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Confirm approve' }))
    expect(seen.body).toBeUndefined()

    await userEvent.type(screen.getByLabelText('Reviewer'), 'reviewer sub-agent')
    expect(screen.getByRole('button', { name: 'Confirm approve' })).not.toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm approve' }))
    await expect.poll(() => seen.body).toEqual({ reviewed_by: 'reviewer sub-agent' })
  })

  it('sends self_review with its required reason', async () => {
    const { seen, handler } = captureBody('post', '/v1/issues/td-6a0883/approve')
    server.use(handler)

    await openApprove()
    await userEvent.click(screen.getByRole('radio', { name: 'I reviewed my own work' }))
    await userEvent.type(screen.getByLabelText('Reason'), 'Re-read the diff after a break')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm approve' }))

    await expect.poll(() => seen.body).toEqual({
      self_review: true,
      reason: 'Re-read the diff after a break',
    })
  })

  // td returns 400 for reviewed_by + self_review together. The UI must make
  // that state unreachable rather than rely on the server to catch it.
  it('offers reviewed_by and self_review as mutually exclusive choices', async () => {
    await openApprove()

    const attributed = screen.getByRole('radio', { name: 'Reviewed by someone else' })
    const self = screen.getByRole('radio', { name: 'I reviewed my own work' })

    await userEvent.click(attributed)
    expect(attributed).toBeChecked()
    expect(self).not.toBeChecked()
    expect(screen.getByLabelText('Reviewer')).toBeInTheDocument()

    await userEvent.click(self)
    expect(self).toBeChecked()
    expect(attributed).not.toBeChecked()
    expect(screen.queryByLabelText('Reviewer')).not.toBeInTheDocument()
  })
})

describe('TransitionBar record-only review', () => {
  // The record-only path attests without closing. Its field is `summary`,
  // not `reason`, and td requires it.
  it('posts to /reviews with a summary instead of closing the issue', async () => {
    const { seen, handler } = captureBody('post', '/v1/issues/td-6a0883/reviews')
    server.use(handler)

    renderBar(['approve'])
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Record only, do not close' }))
    await userEvent.type(screen.getByLabelText('Reason'), 'Verified against the acceptance criteria')
    await userEvent.click(screen.getByRole('button', { name: 'Record review' }))

    await expect.poll(() => seen.body).toEqual({
      decision: 'approved',
      summary: 'Verified against the acceptance criteria',
    })
  })

  it('carries the attribution onto the record-only path', async () => {
    const { seen, handler } = captureBody('post', '/v1/issues/td-6a0883/reviews')
    server.use(handler)

    renderBar(['approve'])
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Record only, do not close' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Reviewed by someone else' }))
    await userEvent.type(screen.getByLabelText('Reviewer'), 'reviewer sub-agent')
    await userEvent.type(screen.getByLabelText('Reason'), 'Looks right')
    await userEvent.click(screen.getByRole('button', { name: 'Record review' }))

    await expect.poll(() => seen.body).toEqual({
      decision: 'approved',
      summary: 'Looks right',
      reviewed_by: 'reviewer sub-agent',
    })
  })

  it('disables record review too when the attribution name is left blank', async () => {
    const { seen, handler } = captureBody('post', '/v1/issues/td-6a0883/reviews')
    server.use(handler)

    renderBar(['approve'])
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Record only, do not close' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Reviewed by someone else' }))
    await userEvent.type(screen.getByLabelText('Reason'), 'Looks right')

    expect(screen.getByRole('button', { name: 'Record review' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Record review' }))
    expect(seen.body).toBeUndefined()
  })

  it('offers record-only for approve alone', async () => {
    renderBar(['reject'])
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect(
      screen.queryByRole('checkbox', { name: 'Record only, do not close' }),
    ).not.toBeInTheDocument()
  })
})

describe('TransitionBar form state across actions', () => {
  // The form is shared, but record-only outlives the fieldset that owns it:
  // once another action takes over, its checkbox is unmounted and cannot be
  // cleared, so a leftover `true` would turn the confirm into a recorded
  // approval on a path the user never chose.
  it('drops record-only when another action takes over the form', async () => {
    const reject = captureBody('post', '/v1/issues/td-6a0883/reject')
    const reviews = captureBody('post', '/v1/issues/td-6a0883/reviews')
    server.use(reject.handler, reviews.handler)

    renderBar(['approve', 'reject'])
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Record only, do not close' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await userEvent.type(screen.getByLabelText('Reason'), 'needs work')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm reject' }))

    await expect.poll(() => reject.seen.body).toEqual({ reason: 'needs work' })
    expect(reviews.seen.body).toBeUndefined()
  })

  // A note written to justify one action must not ride along with another.
  it('drops the typed reason when another action takes over the form', async () => {
    const { seen, handler } = captureBody('post', '/v1/issues/td-6a0883/close')
    server.use(handler)

    renderBar(['block', 'close'])
    await userEvent.click(screen.getByRole('button', { name: 'Block' }))
    await userEvent.type(screen.getByLabelText('Reason'), 'waiting on ops')
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm close' }))

    await expect.poll(() => seen.body).toEqual({})
  })

  it('closes an open form when a transition needing no reason fires', async () => {
    const { seen, handler } = captureBody('post', '/v1/issues/td-6a0883/review')
    server.use(handler)

    renderBar(['review', 'block'])
    await userEvent.click(screen.getByRole('button', { name: 'Block' }))
    await userEvent.click(screen.getByRole('button', { name: 'Request review' }))

    await expect.poll(() => seen.body).toEqual({})
    expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument()
  })
})

describe('TransitionBar error reporting', () => {
  // CLAUDE.md: td's wording is authoritative and reaches the user unchanged.
  it("shows td's mutual-exclusion 400 verbatim", async () => {
    const message =
      'reviewed_by and self_review are mutually exclusive: use reviewed_by when someone else reviewed the work, self_review when you reviewed your own'
    server.use(http.post('/v1/issues/td-6a0883/approve', () =>
      HttpResponse.json({ ok: false, error: { code: 'validation_error', message } },
        { status: 400 })))

    renderBar(['approve'])
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm approve' }))

    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  // Two mutations feed one panel, so a failure must not outlive its form and
  // reappear over an unrelated action.
  it('clears the previous error when the form is cancelled', async () => {
    const message = 'you implemented this issue, so you cannot approve it'
    server.use(http.post('/v1/issues/td-6a0883/approve', () =>
      HttpResponse.json({ ok: false, error: { code: 'forbidden', message } },
        { status: 403 })))

    renderBar(['approve', 'reject'])
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm approve' }))
    expect(await screen.findByText(message)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(message)).not.toBeInTheDocument()
  })

  // Dismissing the form is not a way to un-ask td. The request is already on
  // its way, so its answer — a policy rejection the user needs to read — must
  // still reach the panel. Calling reset() here would detach the observer from
  // the pending mutation and the message would never arrive.
  it("shows td's answer to a transition the form was dismissed during", async () => {
    const message = 'you implemented this issue, so you cannot approve it'
    let release = () => {}
    const answered = new Promise<void>(resolve => { release = resolve })
    server.use(http.post('/v1/issues/td-6a0883/approve', async () => {
      await answered
      return HttpResponse.json({ ok: false, error: { code: 'forbidden', message } },
        { status: 403 })
    }))

    renderBar(['approve'])
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm approve' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument()

    release()
    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  // Same for the record-only path, which rides the second of the two mutations.
  it("shows td's answer to a recorded review the form was dismissed during", async () => {
    const message = 'cannot record review: td-6a0883 is not in_review'
    let release = () => {}
    const answered = new Promise<void>(resolve => { release = resolve })
    server.use(http.post('/v1/issues/td-6a0883/reviews', async () => {
      await answered
      return HttpResponse.json({ ok: false, error: { code: 'conflict', message } },
        { status: 409 })
    }))

    renderBar(['approve'])
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Record only, do not close' }))
    await userEvent.type(screen.getByLabelText('Reason'), 'attesting')
    await userEvent.click(screen.getByRole('button', { name: 'Record review' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    release()
    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it("shows td's rejection from the record-only path verbatim", async () => {
    const message = 'cannot record review: td-6a0883 is not in_review'
    server.use(http.post('/v1/issues/td-6a0883/reviews', () =>
      HttpResponse.json({ ok: false, error: { code: 'conflict', message } },
        { status: 409 })))

    renderBar(['approve'])
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Record only, do not close' }))
    await userEvent.type(screen.getByLabelText('Reason'), 'attesting')
    await userEvent.click(screen.getByRole('button', { name: 'Record review' }))

    expect(await screen.findByText(message)).toBeInTheDocument()
  })
})
