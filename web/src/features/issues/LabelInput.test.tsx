import { describe, expect, it, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import LabelInput from './LabelInput'

const server = setupServer(
  http.get('/v1/labels', () =>
    HttpResponse.json({ ok: true, data: { default_workflow: 'standard', labels: ['alpha', 'beta'] } })),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderInput(value: string[], onChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <LabelInput value={value} onChange={onChange} />
    </QueryClientProvider>,
  )
  return onChange
}

describe('LabelInput', () => {
  it('adds a typed label', async () => {
    const onChange = renderInput(['alpha'])

    await userEvent.type(screen.getByLabelText('Labels'), 'gamma')
    await userEvent.click(screen.getByRole('button', { name: 'Add label' }))

    expect(onChange).toHaveBeenCalledWith(['alpha', 'gamma'])
  })

  it('removes a label by its chip', async () => {
    const onChange = renderInput(['alpha', 'beta'])

    await userEvent.click(screen.getByRole('button', { name: 'Remove label alpha' }))

    expect(onChange).toHaveBeenCalledWith(['beta'])
  })

  it('ignores a duplicate', async () => {
    const onChange = renderInput(['alpha'])

    await userEvent.type(screen.getByLabelText('Labels'), 'alpha')
    await userEvent.click(screen.getByRole('button', { name: 'Add label' }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('removes only the clicked chip when a label is duplicated', async () => {
    const onChange = renderInput(['dup', 'dup', 'other'])

    const chips = screen.getAllByRole('button', { name: 'Remove label dup' })
    expect(chips).toHaveLength(2)
    await userEvent.click(chips[0])

    expect(onChange).toHaveBeenCalledWith(['dup', 'other'])
  })

  it('offers the project labels as suggestions', async () => {
    renderInput([])

    expect(await screen.findByRole('option', { name: 'alpha', hidden: true })).toBeInTheDocument()
  })
})
