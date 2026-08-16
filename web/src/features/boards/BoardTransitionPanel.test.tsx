import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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

function renderPanel(available?: Transition[]) {
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
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BoardTransitionPanel issueId="td-aaa" droppedOn="in_review" onClose={() => {}} />
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

  it('says so when td reports none', async () => {
    renderPanel([])
    expect(await screen.findByText(/no transitions available/i)).toBeInTheDocument()
  })

  it('says so when td omits the field entirely', async () => {
    renderPanel(undefined)
    expect(await screen.findByText(/no transitions available/i)).toBeInTheDocument()
  })
})
