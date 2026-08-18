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

/** The field lives inside a form at both call sites, so Enter has an owner. */
function renderInForm(value: string[], onChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
  render(
    <QueryClientProvider client={qc}>
      <form onSubmit={onSubmit}>
        <LabelInput value={value} onChange={onChange} />
        <button type="submit">Save</button>
      </form>
    </QueryClientProvider>,
  )
  return { onChange, onSubmit }
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

  it('lists the project labels when the field is focused', async () => {
    renderInput([])

    await userEvent.click(screen.getByLabelText('Labels'))

    expect(await screen.findByRole('option', { name: 'alpha' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'beta' })).toBeInTheDocument()
  })

  it('adds a clicked suggestion and closes the list', async () => {
    const onChange = renderInput([])
    await userEvent.click(screen.getByLabelText('Labels'))

    await userEvent.click(await screen.findByRole('option', { name: 'beta' }))

    expect(onChange).toHaveBeenCalledWith(['beta'])
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('does not suggest a label the issue already carries', async () => {
    renderInput(['alpha'])

    await userEvent.click(screen.getByLabelText('Labels'))

    expect(await screen.findByRole('option', { name: 'beta' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'alpha' })).not.toBeInTheDocument()
  })

  it('filters the suggestions by substring, ignoring case', async () => {
    renderInput([])

    await userEvent.type(screen.getByLabelText('Labels'), 'ET')

    expect(await screen.findByRole('option', { name: 'beta' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'alpha' })).not.toBeInTheDocument()
  })

  it('takes the arrowed-to suggestion on Enter without submitting the form', async () => {
    const { onChange, onSubmit } = renderInForm([])
    await userEvent.click(screen.getByLabelText('Labels'))
    await screen.findByRole('option', { name: 'alpha' })

    await userEvent.keyboard('{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledWith(['alpha'])
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('still adds the typed text on Enter when no suggestion is highlighted', async () => {
    const { onChange, onSubmit } = renderInForm([])

    await userEvent.type(screen.getByLabelText('Labels'), 'gamma{Enter}')

    expect(onChange).toHaveBeenCalledWith(['gamma'])
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('closes the list on Escape and keeps the typed text', async () => {
    renderInput([])
    const input = screen.getByLabelText('Labels')
    await userEvent.type(input, 'al')
    expect(await screen.findByRole('option', { name: 'alpha' })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(input).toHaveValue('al')
  })
})
