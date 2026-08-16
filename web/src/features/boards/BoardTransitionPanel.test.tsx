import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import BoardTransitionPanel from './BoardTransitionPanel'
import { makeIssue } from '../issues/issue.fixture'
import type { Transition } from '../../api/types'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderPanel(available?: Transition[], onClose: () => void = () => {}) {
  server.use(http.get('/v1/issues/:id', () => HttpResponse.json({
    ok: true,
    data: {
      issue: makeIssue({ id: 'td-aaa', available_transitions: available }),
      logs: [], comments: [], dependencies: [], blocked_by: [], latest_handoff: null,
    },
  })))
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BoardTransitionPanel issueId="td-aaa" droppedOn="in_review" onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BoardTransitionPanel', () => {
  it('names the column the card was dropped on', async () => {
    renderPanel(['review'])
    expect(await screen.findByText('Dropped on: In review')).toBeInTheDocument()
  })

  // Board cards carry no available_transitions — the panel must fetch the
  // issue rather than guess an action from the target column, which is
  // ambiguous in both directions (closed ← approve or close).
  it('offers exactly the transitions td reported', async () => {
    renderPanel(['review', 'block'])
    expect(await screen.findByRole('button', { name: 'Request review' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Block' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  // The placeholder is the issue list's row skeleton. Inside a small inline
  // panel it has to say what is actually being waited for, and be one row
  // rather than five fake table rows.
  it('says what it is waiting for while the issue loads', () => {
    renderPanel(['review'])
    expect(screen.getByRole('status', { name: 'Loading transitions' })).toBeInTheDocument()
  })

  it('says so when td reports none', async () => {
    renderPanel([])
    expect(await screen.findByText(/no transitions available/i)).toBeInTheDocument()
  })

  it('says so when td omits the field entirely', async () => {
    renderPanel(undefined)
    expect(await screen.findByText(/no transitions available/i)).toBeInTheDocument()
  })

  // The panel is a proposal: once td has accepted the transition there is
  // nothing left to choose, and leaving it open is the only acknowledgement
  // the user would get.
  it('closes once td accepts the transition', async () => {
    server.use(http.post('/v1/issues/:id/review', () =>
      HttpResponse.json({ ok: true, data: {} })))
    let closed = false
    renderPanel(['review'], () => { closed = true })

    await userEvent.click(await screen.findByRole('button', { name: 'Request review' }))
    await waitFor(() => expect(closed).toBe(true))
  })

  // A drop does not move DOM focus itself, so Escape only reaches the panel
  // if it takes focus on mount. Firing on document.activeElement rather than
  // focusing the dialog by hand is the point: this only passes if the panel
  // moved focus there itself, not because the test did.
  it('closes on Escape once it has taken focus on open', async () => {
    let closed = false
    renderPanel(['review'], () => { closed = true })
    await screen.findByRole('dialog', { name: 'Move td-aaa' })
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(closed).toBe(true)
  })

  // Taking focus is only half of it: dropping it on unmount leaves the user on
  // <body> with the tab order restarted, which after Escape is the one moment
  // they are most likely to keep using the keyboard.
  it('gives focus back to where it was when it closes', async () => {
    const before = document.createElement('button')
    document.body.append(before)
    before.focus()

    const { unmount } = renderPanel(['review'])
    await screen.findByRole('dialog', { name: 'Move td-aaa' })
    expect(document.activeElement).not.toBe(before)

    unmount()
    expect(document.activeElement).toBe(before)
    before.remove()
  })
})
