import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render as rtlRender, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import IssueFilters from './IssueFilters'
import { FETCH_LIMIT } from '../../api/queries'
import { makeBoard } from '../boards/board.fixture'

// The filters carry SavedQueryBar, which asks td for the project's boards.
const server = setupServer(
  http.get('/v1/boards', () =>
    HttpResponse.json({ ok: true, data: { boards: [makeBoard()] } })),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

/** Every case renders the bar too, so every case needs a query client. */
function Providers({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: Providers })

/** The handlers the saved-query bar needs, for cases that ignore it. */
const bar = { onPick: vi.fn(), onSaved: vi.fn() }

afterEach(() => {
  vi.useRealTimers()
})

describe('IssueFilters', () => {
  it('does not call onChange for every keystroke — only once the typing pauses', () => {
    const onChange = vi.fn()
    vi.useFakeTimers()

    render(<IssueFilters {...bar} params={{ limit: FETCH_LIMIT }} onChange={onChange} />)
    const input = screen.getByLabelText('Search')
    fireEvent.change(input, { target: { value: 'a' } })
    fireEvent.change(input, { target: { value: 'au' } })
    fireEvent.change(input, { target: { value: 'aut' } })
    fireEvent.change(input, { target: { value: 'auth' } })

    // Four keystrokes, still within the debounce window: no request fired yet.
    expect(onChange).not.toHaveBeenCalled()

    vi.advanceTimersByTime(300)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ limit: FETCH_LIMIT, search: 'auth' })
  })

  it('restarts the delay on each keystroke rather than firing on a fixed interval', () => {
    const onChange = vi.fn()
    vi.useFakeTimers()

    render(<IssueFilters {...bar} params={{ limit: FETCH_LIMIT }} onChange={onChange} />)
    const input = screen.getByLabelText('Search')

    fireEvent.change(input, { target: { value: 'a' } })
    vi.advanceTimersByTime(200)
    fireEvent.change(input, { target: { value: 'ab' } })
    vi.advanceTimersByTime(200)
    // 400ms have elapsed in total, more than the 300ms delay, but each
    // keystroke reset the timer so it still hasn't fired.
    expect(onChange).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ limit: FETCH_LIMIT, search: 'ab' })
  })

  it('merges the debounced search into the latest params rather than a stale snapshot', () => {
    const onChange = vi.fn()
    vi.useFakeTimers()

    const { rerender } = render(
      <IssueFilters {...bar} params={{ limit: FETCH_LIMIT }} onChange={onChange} />,
    )
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'x' } })

    // A status filter is toggled directly (not through the debounced path)
    // while the search debounce is still pending.
    rerender(
      <IssueFilters {...bar} params={{ limit: FETCH_LIMIT, status: ['open'] }} onChange={onChange} />,
    )

    vi.advanceTimersByTime(300)
    expect(onChange).toHaveBeenCalledWith({
      limit: FETCH_LIMIT, status: ['open'], search: 'x',
    })
  })

  it('sends undefined rather than an empty string once the search is cleared', () => {
    const onChange = vi.fn()
    vi.useFakeTimers()

    render(
      <IssueFilters {...bar} params={{ limit: FETCH_LIMIT, search: 'auth' }} onChange={onChange} />,
    )
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '' } })

    vi.advanceTimersByTime(300)
    expect(onChange).toHaveBeenCalledWith({ limit: FETCH_LIMIT, search: undefined })
  })

  describe('TDQ mode', () => {
    it('runs nothing while a query is being typed — not even after the debounce', () => {
      const onChange = vi.fn()
      vi.useFakeTimers()

      render(<IssueFilters {...bar} params={{ limit: FETCH_LIMIT }} onChange={onChange} />)
      fireEvent.change(screen.getByLabelText('Search'), { target: { value: '?status =' } })

      // A half-typed query is a parse error, and a parse error costs a
      // subprocess and an error panel. Nothing may run before Enter.
      vi.advanceTimersByTime(1000)
      expect(onChange).not.toHaveBeenCalled()
    })

    it('runs the query on Enter, with the ? stripped', () => {
      const onChange = vi.fn()

      render(<IssueFilters {...bar} params={{ limit: FETCH_LIMIT }} onChange={onChange} />)
      const input = screen.getByLabelText('Search')
      fireEvent.change(input, { target: { value: '?type = bug AND priority <= P1' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(onChange).toHaveBeenCalledWith({
        limit: FETCH_LIMIT,
        query: 'type = bug AND priority <= P1',
        search: undefined,
      })
    })

    it('ignores Enter on a ? with nothing behind it', () => {
      const onChange = vi.fn()
      vi.useFakeTimers()

      render(<IssueFilters {...bar} params={{ limit: FETCH_LIMIT }} onChange={onChange} />)
      const input = screen.getByLabelText('Search')
      fireEvent.change(input, { target: { value: '?  ' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      vi.advanceTimersByTime(1000)
      expect(onChange).not.toHaveBeenCalled()
    })

    it('leaves query mode when the ? is removed, without waiting for Enter', () => {
      const onChange = vi.fn()
      vi.useFakeTimers()

      render(
        <IssueFilters {...bar} params={{ limit: FETCH_LIMIT, query: 'type = bug' }} onChange={onChange} />,
      )
      fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'auth' } })

      vi.advanceTimersByTime(300)
      expect(onChange).toHaveBeenCalledWith({
        limit: FETCH_LIMIT, search: 'auth', query: undefined,
      })
    })

    it('shows the committed query as the box contents, ? and all', () => {
      render(
        <IssueFilters {...bar} params={{ limit: FETCH_LIMIT, query: 'type = bug' }} onChange={vi.fn()} />,
      )

      expect(screen.getByLabelText('Search')).toHaveValue('?type = bug')
    })

    it('keeps Enter out of full-text search — that path stays debounced', () => {
      const onChange = vi.fn()
      vi.useFakeTimers()

      render(<IssueFilters {...bar} params={{ limit: FETCH_LIMIT }} onChange={onChange} />)
      const input = screen.getByLabelText('Search')
      fireEvent.change(input, { target: { value: 'auth' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(onChange).not.toHaveBeenCalled()
      vi.advanceTimersByTime(300)
      expect(onChange).toHaveBeenCalledWith({ limit: FETCH_LIMIT, search: 'auth' })
    })
  })
  describe('the clear button', () => {
    it('offers nothing to clear while the box is empty', () => {
      render(<IssueFilters {...bar} params={{ limit: FETCH_LIMIT }} onChange={vi.fn()} />)

      expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
    })

    it('empties the box and the params on the click, without waiting for the debounce', () => {
      const onChange = vi.fn()
      vi.useFakeTimers()
      render(
        <IssueFilters {...bar}
          params={{ limit: FETCH_LIMIT, search: 'auth', status: ['open'] }}
          onChange={onChange}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))

      expect(screen.getByLabelText('Search')).toHaveValue('')
      expect(onChange).toHaveBeenCalledTimes(1)
      // The chips are a separate control and are left alone.
      expect(onChange).toHaveBeenCalledWith({
        limit: FETCH_LIMIT, status: ['open'], search: undefined, query: undefined,
      })
    })

    it('leaves query mode on the same click', () => {
      const onChange = vi.fn()
      render(
        <IssueFilters {...bar} params={{ limit: FETCH_LIMIT, query: 'type = bug' }} onChange={onChange} />,
      )
      expect(screen.getByLabelText('Search')).toHaveValue('?type = bug')

      fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))

      expect(onChange).toHaveBeenCalledWith({
        limit: FETCH_LIMIT, search: undefined, query: undefined,
      })
      expect(screen.getByLabelText('Search')).toHaveValue('')
    })

    it('leaves the cursor in the box, ready for the next search', () => {
      render(<IssueFilters {...bar} params={{ limit: FETCH_LIMIT, search: 'auth' }} onChange={vi.fn()} />)

      fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))

      expect(screen.getByLabelText('Search')).toHaveFocus()
    })

    it('goes away once there is nothing left to clear', () => {
      render(<IssueFilters {...bar} params={{ limit: FETCH_LIMIT, search: 'auth' }} onChange={vi.fn()} />)

      fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))

      expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
    })
  })

  describe('the TDQ hint', () => {
    it('stands under the box before anyone has typed a query', () => {
      render(<IssueFilters {...bar} params={{ limit: FETCH_LIMIT }} onChange={vi.fn()} />)

      // The hint is how a reader learns the box takes a query at all, so it
      // cannot wait for the one thing it is there to teach.
      expect(screen.getByText(/press Enter to run/)).toBeInTheDocument()
    })

    it('stays put once a query is running', () => {
      render(
        <IssueFilters
          {...bar} params={{ limit: FETCH_LIMIT, query: 'type = bug' }} onChange={vi.fn()}
        />,
      )

      expect(screen.getByText(/press Enter to run/)).toBeInTheDocument()
    })
  })

  describe('saved queries', () => {
    it('offers the saved queries beside the box, whether or not one is running', () => {
      render(<IssueFilters {...bar} params={{ limit: FETCH_LIMIT }} onChange={vi.fn()} />)

      expect(screen.getByRole('button', { name: 'Saved queries' })).toBeInTheDocument()
    })

    it('puts a picked query in the box, ? and all, and runs it', async () => {
      const onChange = vi.fn()
      const onPick = vi.fn()
      render(
        <IssueFilters
          {...bar} params={{ limit: FETCH_LIMIT }} onChange={onChange} onPick={onPick}
        />,
      )

      await userEvent.click(screen.getByRole('button', { name: 'Saved queries' }))
      await userEvent.click(await screen.findByRole('menuitem', { name: /Sprint 1/ }))

      // The box is the one control that says what is running, so it follows a
      // pick even though nothing was typed into it.
      expect(screen.getByLabelText('Search')).toHaveValue('?priority <= P1')
      expect(onPick).toHaveBeenCalledWith('priority <= P1', 'bd-sprint1')
      expect(onChange).not.toHaveBeenCalled()
    })
  })
})
