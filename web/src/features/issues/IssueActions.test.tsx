import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse, delay } from 'msw'
import IssueActions from './IssueActions'
import { makeIssue } from './issue.fixture'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderActions(over: Parameters<typeof makeIssue>[0] = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const issue = makeIssue(over)
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/issues/${issue.id}`]}>
        <Routes>
          <Route path="/" element={<div>issue list</div>} />
          <Route
            path="/issues/:id"
            element={<IssueActions issue={issue} editing={false} onEdit={() => {}} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...utils, issue, qc }
}

describe('IssueActions', () => {
  // The one way to work outward from a parent: the combobox in the form
  // attaches a child once you are already looking at the child. It lives in
  // this row rather than beside the Tasks group, which does not exist until
  // the issue already has a task.
  it('offers to create a task under the issue', () => {
    renderActions({ id: 'td-epic00' })

    expect(screen.getByRole('link', { name: '+ Task' }))
      .toHaveAttribute('href', '/new?parent=td-epic00')
  })

  it('acknowledges a focus request without claiming to read focus state back', async () => {
    server.use(http.put('/v1/focus', () => HttpResponse.json({ ok: true, data: {} })))
    renderActions()

    await userEvent.click(screen.getByRole('button', { name: 'Focus' }))

    expect(await screen.findByText('focus set')).toBeInTheDocument()
  })

  it('navigates away after a confirmed delete', async () => {
    server.use(http.delete('/v1/issues/:id', () => HttpResponse.json({ ok: true, data: {} })))
    renderActions()

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

    expect(await screen.findByText('issue list')).toBeInTheDocument()
  })

  it("shows td's rejection for the action that produced it, not a stale sibling error", async () => {
    server.use(
      http.put('/v1/focus', () =>
        HttpResponse.json({ ok: false, error: { code: 'validation_error', message: 'cannot set focus' } }, { status: 400 })),
    )
    const { container } = renderActions()

    await userEvent.click(screen.getByRole('button', { name: 'Focus' }))
    const rejection = await screen.findByText('cannot set focus')
    expect(rejection).toBeInTheDocument()

    // Pins the half of the component's interface the issue header consumes:
    // the button row and the rejection panel are both direct children of the
    // host, siblings rather than one nested inside the other — the shape
    // IssueDetail's grid depends on to give the panel a full row of its own.
    const buttonRow = screen.getByRole('button', { name: 'Focus' }).parentElement
    const panelWrapper = rejection.closest('[role="alert"]')?.parentElement
    expect(buttonRow?.parentElement).toBe(container)
    expect(panelWrapper?.parentElement).toBe(container)
    expect(panelWrapper).not.toBe(buttonRow)

    server.use(http.delete('/v1/issues/:id', () => HttpResponse.json({ ok: true, data: {} })))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(screen.queryByText('cannot set focus')).not.toBeInTheDocument())
  })

  // Regression test: `busy` was computed but never wired into either
  // button's `disabled` prop, so a focus request could fire while a delete
  // was still in flight (and vice versa), silently dropping whichever
  // outcome lost the race once `lastAction` moved on to the other.
  it('disables Focus while a delete confirmation is pending, and re-enables it once the delete settles', async () => {
    server.use(http.delete('/v1/issues/:id', async () => {
      await delay(50)
      return HttpResponse.json({ ok: true, data: {} })
    }))
    renderActions()

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

    expect(screen.getByRole('button', { name: 'Focus' })).toBeDisabled()

    await screen.findByText('issue list')
  })

  it('disables the delete trigger while a focus request is pending, and re-enables it once the focus settles', async () => {
    server.use(http.put('/v1/focus', async () => {
      await delay(50)
      return HttpResponse.json({ ok: true, data: {} })
    }))
    renderActions()

    await userEvent.click(screen.getByRole('button', { name: 'Focus' }))

    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).not.toBeDisabled())
  })

  it('clears a stale focus acknowledgement and error once the issue changes underneath it', async () => {
    server.use(
      http.put('/v1/focus', () =>
        HttpResponse.json({ ok: false, error: { code: 'validation_error', message: 'cannot set focus' } }, { status: 400 })),
    )
    const { rerender, issue, qc } = renderActions()

    await userEvent.click(screen.getByRole('button', { name: 'Focus' }))
    expect(await screen.findByText('cannot set focus')).toBeInTheDocument()

    rerender(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/issues/${issue.id}`]}>
          <Routes>
            <Route path="/" element={<div>issue list</div>} />
            <Route
              path="/issues/:id"
              element={(
                <IssueActions
                  issue={{ ...issue, updated_at: '2026-08-15T00:00:00+02:00' }}
                  editing={false}
                  onEdit={() => {}}
                />
              )}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.queryByText('cannot set focus')).not.toBeInTheDocument()
  })

  // td phrases action rejections precisely and the GUI shows them unchanged,
  // which includes giving them room to be read. This component renders no root
  // element of its own so its host can put the buttons in one grid cell while
  // the rejection panel spans a full row underneath them.
  it('renders no wrapper element of its own', async () => {
    const { container } = renderActions()
    const edit = await screen.findByRole('button', { name: 'Edit' })

    expect(edit.parentElement?.parentElement).toBe(container)
  })
})
