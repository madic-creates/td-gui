import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import DependencyPanel from './DependencyPanel'
import type { Dependency } from '../../api/types'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const dependency: Dependency = {
  dep_id: 'dep_f7585e15', issue_id: 'td-6a0883',
  depends_on_id: 'td-ffe762', relation_type: 'depends_on',
}

function renderPanel(dependencies: Dependency[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DependencyPanel issueId="td-6a0883" dependencies={dependencies} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('DependencyPanel', () => {
  it('posts depends_on when a dependency is added', async () => {
    let body: unknown
    server.use(http.post('/v1/issues/td-6a0883/dependencies', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ ok: true, data: { dependency } })
    }))
    renderPanel([])

    await userEvent.type(screen.getByLabelText('Depends on'), 'td-ffe762')
    await userEvent.click(screen.getByRole('button', { name: 'Add dependency' }))

    await waitFor(() => expect(body).toEqual({ depends_on: 'td-ffe762' }))
  })

  // These errors carry no details.fields, so binding them to a field would
  // show nothing at all.
  it("shows td's circular-dependency message verbatim", async () => {
    server.use(http.post('/v1/issues/td-6a0883/dependencies', () =>
      HttpResponse.json({
        ok: false,
        error: { code: 'validation_error', message: 'cannot add dependency: would create circular dependency' },
      }, { status: 400 })))
    renderPanel([])

    await userEvent.type(screen.getByLabelText('Depends on'), 'td-6a0883')
    await userEvent.click(screen.getByRole('button', { name: 'Add dependency' }))

    expect(await screen.findByText('cannot add dependency: would create circular dependency')).toBeInTheDocument()
  })

  it('removes a dependency by dep_id after confirming', async () => {
    let removed = ''
    server.use(http.delete('/v1/issues/td-6a0883/dependencies/:depId', ({ params }) => {
      removed = String(params.depId)
      return HttpResponse.json({ ok: true, data: { removed: true } })
    }))
    renderPanel([dependency])

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm remove' }))

    await waitFor(() => expect(removed).toBe('dep_f7585e15'))
  })

  it('renders nothing but the add control when there are no dependencies', () => {
    renderPanel([])
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('fires no request for a whitespace-only entry', async () => {
    let called = false
    server.use(http.post('/v1/issues/td-6a0883/dependencies', () => {
      called = true
      return HttpResponse.json({ ok: true, data: { dependency } })
    }))
    renderPanel([])

    await userEvent.type(screen.getByLabelText('Depends on'), '   ')
    await userEvent.click(screen.getByRole('button', { name: 'Add dependency' }))

    expect(called).toBe(false)
  })

  it('clears a stale add error when a subsequent remove succeeds', async () => {
    server.use(http.post('/v1/issues/td-6a0883/dependencies', () =>
      HttpResponse.json({
        ok: false,
        error: { code: 'validation_error', message: 'cannot add dependency: would create circular dependency' },
      }, { status: 400 })))
    renderPanel([dependency])

    await userEvent.type(screen.getByLabelText('Depends on'), 'td-6a0883')
    await userEvent.click(screen.getByRole('button', { name: 'Add dependency' }))
    expect(await screen.findByText('cannot add dependency: would create circular dependency')).toBeInTheDocument()

    server.use(http.delete('/v1/issues/td-6a0883/dependencies/:depId', () =>
      HttpResponse.json({ ok: true, data: { removed: true } })))

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm remove' }))

    await waitFor(() => expect(
      screen.queryByText('cannot add dependency: would create circular dependency'),
    ).not.toBeInTheDocument())
  })

  it('shows the fresh remove error, not a stale add error, when both fail', async () => {
    server.use(http.post('/v1/issues/td-6a0883/dependencies', () =>
      HttpResponse.json({
        ok: false,
        error: { code: 'validation_error', message: 'cannot add dependency: would create circular dependency' },
      }, { status: 400 })))
    renderPanel([dependency])

    await userEvent.type(screen.getByLabelText('Depends on'), 'td-6a0883')
    await userEvent.click(screen.getByRole('button', { name: 'Add dependency' }))
    expect(await screen.findByText('cannot add dependency: would create circular dependency')).toBeInTheDocument()

    server.use(http.delete('/v1/issues/td-6a0883/dependencies/:depId', () =>
      HttpResponse.json({
        ok: false,
        error: { code: 'not_found', message: 'dependency not found: dep_f7585e15' },
      }, { status: 404 })))

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm remove' }))

    expect(await screen.findByText('dependency not found: dep_f7585e15')).toBeInTheDocument()
    expect(screen.queryByText('cannot add dependency: would create circular dependency')).not.toBeInTheDocument()
  })
})
