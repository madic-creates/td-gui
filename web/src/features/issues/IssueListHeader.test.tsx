import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IssueListHeader from './IssueListHeader'
import { DEFAULT_SORT } from './ordering'

describe('IssueListHeader', () => {
  it('states the current sort and what a click would do', () => {
    render(<IssueListHeader sort={DEFAULT_SORT} onChange={vi.fn()} />)
    expect(screen.getByRole('button', {
      name: 'Sorted by priority, ascending. Sort descending.',
    })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sort by title, ascending' }))
      .toBeInTheDocument()
  })

  it('flips the direction when the active column is clicked again', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<IssueListHeader sort={DEFAULT_SORT} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: /^Sorted by priority/ }))
    expect(onChange).toHaveBeenCalledWith({ key: 'priority', direction: 'desc' })
  })

  it('starts a new column ascending rather than inheriting the direction', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <IssueListHeader
        sort={{ key: 'priority', direction: 'desc' }}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Sort by updated, ascending' }))
    expect(onChange).toHaveBeenCalledWith({ key: 'updated', direction: 'asc' })
  })

  it('offers no sort control for status, which is the grouping', () => {
    render(<IssueListHeader sort={DEFAULT_SORT} onChange={vi.fn()} />)
    expect(screen.getByText('STATUS')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /status/i })).not.toBeInTheDocument()
  })
})
