import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import IssueFilters from './IssueFilters'
import { FETCH_LIMIT } from '../../api/queries'

afterEach(() => {
  vi.useRealTimers()
})

describe('IssueFilters', () => {
  it('does not call onChange for every keystroke — only once the typing pauses', () => {
    const onChange = vi.fn()
    vi.useFakeTimers()

    render(<IssueFilters params={{ limit: FETCH_LIMIT }} onChange={onChange} />)
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

    render(<IssueFilters params={{ limit: FETCH_LIMIT }} onChange={onChange} />)
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
      <IssueFilters params={{ limit: FETCH_LIMIT }} onChange={onChange} />,
    )
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'x' } })

    // A status filter is toggled directly (not through the debounced path)
    // while the search debounce is still pending.
    rerender(
      <IssueFilters params={{ limit: FETCH_LIMIT, status: ['open'] }} onChange={onChange} />,
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
      <IssueFilters params={{ limit: FETCH_LIMIT, search: 'auth' }} onChange={onChange} />,
    )
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '' } })

    vi.advanceTimersByTime(300)
    expect(onChange).toHaveBeenCalledWith({ limit: FETCH_LIMIT, search: undefined })
  })

  describe('TDQ mode', () => {
    it('runs nothing while a query is being typed — not even after the debounce', () => {
      const onChange = vi.fn()
      vi.useFakeTimers()

      render(<IssueFilters params={{ limit: FETCH_LIMIT }} onChange={onChange} />)
      fireEvent.change(screen.getByLabelText('Search'), { target: { value: '?status =' } })

      // A half-typed query is a parse error, and a parse error costs a
      // subprocess and an error panel. Nothing may run before Enter.
      vi.advanceTimersByTime(1000)
      expect(onChange).not.toHaveBeenCalled()
    })

    it('runs the query on Enter, with the ? stripped', () => {
      const onChange = vi.fn()

      render(<IssueFilters params={{ limit: FETCH_LIMIT }} onChange={onChange} />)
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

      render(<IssueFilters params={{ limit: FETCH_LIMIT }} onChange={onChange} />)
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
        <IssueFilters params={{ limit: FETCH_LIMIT, query: 'type = bug' }} onChange={onChange} />,
      )
      fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'auth' } })

      vi.advanceTimersByTime(300)
      expect(onChange).toHaveBeenCalledWith({
        limit: FETCH_LIMIT, search: 'auth', query: undefined,
      })
    })

    it('shows the committed query as the box contents, ? and all', () => {
      render(
        <IssueFilters params={{ limit: FETCH_LIMIT, query: 'type = bug' }} onChange={vi.fn()} />,
      )

      expect(screen.getByLabelText('Search')).toHaveValue('?type = bug')
    })

    it('keeps Enter out of full-text search — that path stays debounced', () => {
      const onChange = vi.fn()
      vi.useFakeTimers()

      render(<IssueFilters params={{ limit: FETCH_LIMIT }} onChange={onChange} />)
      const input = screen.getByLabelText('Search')
      fireEvent.change(input, { target: { value: 'auth' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(onChange).not.toHaveBeenCalled()
      vi.advanceTimersByTime(300)
      expect(onChange).toHaveBeenCalledWith({ limit: FETCH_LIMIT, search: 'auth' })
    })
  })
})
