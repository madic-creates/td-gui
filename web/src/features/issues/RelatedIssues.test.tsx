import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import RelatedIssues, { SEARCH_MIN_ITEMS } from './RelatedIssues'
import { makeIssue } from './issue.fixture'

const show = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('RelatedIssues', () => {
  it('lists a resolved reference with its title and status', () => {
    const issue = makeIssue({ id: 'td-aaa', title: 'The blocker', status: 'in_review' })
    show(<RelatedIssues title="Blocked by" items={[{ id: 'td-aaa', issue }]} />)

    expect(screen.getByText('Blocked by (1)')).toBeInTheDocument()
    expect(screen.getByText('The blocker')).toBeInTheDocument()
    expect(screen.getByText('in_review')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'td-aaa' })).toHaveAttribute('href', '/issues/td-aaa')
  })

  // The index may be capped or the issue deleted. The row still links, which
  // is what it did before titles existed — and claims nothing it cannot know.
  it('falls back to the bare id when the reference is unresolved', () => {
    show(<RelatedIssues title="Blocked by" items={[{ id: 'td-zzz', issue: null }]} />)

    expect(screen.getByRole('link', { name: 'td-zzz' })).toHaveAttribute('href', '/issues/td-zzz')
    expect(screen.queryByText('not found')).not.toBeInTheDocument()
    expect(screen.queryByText('unknown')).not.toBeInTheDocument()
  })

  it('renders nothing at all for an empty group', () => {
    const { container } = show(<RelatedIssues title="Blocks" items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('counts the rows in the heading', () => {
    show(<RelatedIssues title="Blocks" items={[
      { id: 'td-aaa', issue: makeIssue({ id: 'td-aaa' }) },
      { id: 'td-bbb', issue: null },
    ]} />)

    expect(screen.getByText('Blocks (2)')).toBeInTheDocument()
  })

  describe('search', () => {
    const tasks = Array.from({ length: SEARCH_MIN_ITEMS }, (_, n) => {
      const id = `td-task${n}`
      return { id, issue: makeIssue({ id, title: `Task number ${n}` }) }
    })
    tasks[0].issue.title = 'Wire the Login form'
    tasks[1].issue.title = 'Document the login flow'

    const rows = () => screen.getAllByRole('listitem').map(row => row.textContent)

    it('narrows the rows to titles containing the text, ignoring case', async () => {
      show(<RelatedIssues title="Tasks" items={tasks} searchable />)
      await userEvent.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'LOGIN')

      expect(screen.getAllByRole('listitem')).toHaveLength(2)
      expect(screen.getByText('Wire the Login form')).toBeInTheDocument()
      expect(screen.getByText('Document the login flow')).toBeInTheDocument()
    })

    it('matches on the id as well', async () => {
      show(<RelatedIssues title="Tasks" items={tasks} searchable />)
      await userEvent.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'TD-TASK3')

      expect(rows()).toEqual([expect.stringContaining('Task number 3')])
    })

    // The heading counts the group, not the search: the number next to
    // "Tasks" is what the issue has, and it should not flicker while typing.
    it('keeps the full count in the heading while filtering', async () => {
      show(<RelatedIssues title="Tasks" items={tasks} searchable />)
      await userEvent.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'login')

      expect(screen.getByText(`Tasks (${SEARCH_MIN_ITEMS})`)).toBeInTheDocument()
    })

    it('resets the filter with the clear button', async () => {
      show(<RelatedIssues title="Tasks" items={tasks} searchable />)
      const box = screen.getByRole('searchbox', { name: 'Search tasks' })
      await userEvent.type(box, 'login')
      await userEvent.click(screen.getByRole('button', { name: 'Clear tasks search' }))

      expect(box).toHaveValue('')
      expect(screen.getAllByRole('listitem')).toHaveLength(SEARCH_MIN_ITEMS)
      expect(box).toHaveFocus()
    })

    it('resets the filter with Escape', async () => {
      show(<RelatedIssues title="Tasks" items={tasks} searchable />)
      const box = screen.getByRole('searchbox', { name: 'Search tasks' })
      await userEvent.type(box, 'login{Escape}')

      expect(box).toHaveValue('')
      expect(screen.getAllByRole('listitem')).toHaveLength(SEARCH_MIN_ITEMS)
    })

    it('says so when nothing matches', async () => {
      show(<RelatedIssues title="Tasks" items={tasks} searchable />)
      await userEvent.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'nothing like this')

      expect(screen.queryAllByRole('listitem')).toHaveLength(0)
      expect(screen.getByText('No tasks match "nothing like this".')).toBeInTheDocument()
    })

    // A short list is read faster than it is searched.
    it(`offers no box below ${SEARCH_MIN_ITEMS} rows`, () => {
      show(<RelatedIssues title="Tasks" items={tasks.slice(1)} searchable />)
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    })

    it('offers no box for a group that is not searchable', () => {
      show(<RelatedIssues title="Blocks" items={tasks} />)
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    })
  })
})
