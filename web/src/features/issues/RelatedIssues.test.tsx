import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import RelatedIssues, { SEARCH_MIN_ITEMS } from './RelatedIssues'
import { makeIssue } from './issue.fixture'
import EpicProgress from '../epics/EpicProgress'
import { childIndex, rollup } from '../epics/epicRollup'

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

  describe('status filter', () => {
    const parent = 'td-epic'
    const issues = [
      makeIssue({ id: 'td-a', title: 'Alpha login', status: 'open', parent_id: parent }),
      makeIssue({ id: 'td-b', title: 'Beta', status: 'in_progress', parent_id: parent }),
      makeIssue({ id: 'td-c', title: 'Gamma login', status: 'in_progress', parent_id: parent }),
      makeIssue({ id: 'td-d', title: 'Delta', status: 'closed', parent_id: parent }),
      makeIssue({ id: 'td-e', title: 'Epsilon', status: 'closed', parent_id: parent }),
      makeIssue({ id: 'td-f', title: 'Zeta', status: 'closed', parent_id: parent }),
    ]
    const tasks = issues.map(issue => ({ id: issue.id, issue }))
    const progress = rollup(childIndex(issues), parent)
    const group = () => show(
      <RelatedIssues title="Tasks" items={tasks} searchable
        lead={({ statuses, toggle }) => (
          <EpicProgress rollup={progress} selected={statuses} onSelect={toggle} />
        )} />,
    )
    const titles = () => screen.getAllByRole('listitem').map(row => row.textContent)

    it('narrows the rows to the status picked in the legend', async () => {
      group()
      await userEvent.click(screen.getByRole('button', { name: /In progress 2/ }))

      expect(titles()).toEqual([expect.stringContaining('Beta'), expect.stringContaining('Gamma')])
      expect(screen.getByText('Tasks (6)')).toBeInTheDocument()
    })

    it('clears the filter when the same status is picked again', async () => {
      group()
      const entry = screen.getByRole('button', { name: /Closed 3/ })
      await userEvent.click(entry)
      expect(screen.getAllByRole('listitem')).toHaveLength(3)
      await userEvent.click(entry)
      expect(screen.getAllByRole('listitem')).toHaveLength(6)
      expect(entry).toHaveAttribute('aria-pressed', 'false')
    })

    it('shows the rows of every status picked', async () => {
      group()
      await userEvent.click(screen.getByRole('button', { name: /Open 1/ }))
      await userEvent.click(screen.getByRole('button', { name: /In progress 2/ }))

      expect(titles()).toEqual([
        expect.stringContaining('Alpha'),
        expect.stringContaining('Beta'),
        expect.stringContaining('Gamma'),
      ])
      expect(screen.getByRole('button', { name: /Open 1/ })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: /In progress 2/ })).toHaveAttribute('aria-pressed', 'true')

      await userEvent.click(screen.getByRole('button', { name: /Open 1/ }))
      expect(screen.getAllByRole('listitem')).toHaveLength(2)
    })

    it('names every status picked when nothing matches', async () => {
      group()
      await userEvent.click(screen.getByRole('button', { name: /Open 1/ }))
      await userEvent.click(screen.getByRole('button', { name: /Closed 3/ }))
      await userEvent.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'gamma')

      expect(screen.getByText('No open or closed tasks match "gamma".')).toBeInTheDocument()
    })

    // The last in-review task is closed while the page is open: the legend
    // loses its "In review" toggle, so the filter must not keep hiding rows
    // behind a button that is no longer there to unpick.
    it('drops a picked status once the legend no longer offers it', async () => {
      const before = [...issues, makeIssue({ id: 'td-g', title: 'Eta', status: 'in_review', parent_id: parent })]
      const after = before.map(issue => (issue.id === 'td-g' ? { ...issue, status: 'closed' as const } : issue))
      const at = (list: typeof issues) => {
        const progress = rollup(childIndex(list), parent)
        return (
          <MemoryRouter>
            <RelatedIssues title="Tasks" searchable
              items={list.map(issue => ({ id: issue.id, issue }))}
              pickable={progress.buckets.map(bucket => bucket.status)}
              lead={({ statuses, toggle }) => (
                <EpicProgress rollup={progress} selected={statuses} onSelect={toggle} />
              )} />
          </MemoryRouter>
        )
      }

      const { rerender } = render(at(before))
      await userEvent.click(screen.getByRole('button', { name: /In review 1/ }))
      expect(titles()).toEqual([expect.stringContaining('Eta')])

      rerender(at(after))
      expect(screen.queryByRole('button', { name: /In review/ })).not.toBeInTheDocument()
      expect(screen.getAllByRole('listitem')).toHaveLength(7)

      // It stays dropped: a task moving back into review does not bring the
      // filter back with it.
      rerender(at(before))
      expect(screen.getByRole('button', { name: /In review 1/ })).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getAllByRole('listitem')).toHaveLength(7)
    })

    it('combines with the text search', async () => {
      group()
      await userEvent.click(screen.getByRole('button', { name: /In progress 2/ }))
      await userEvent.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'login')
      expect(titles()).toEqual([expect.stringContaining('Gamma login')])

      await userEvent.clear(screen.getByRole('searchbox', { name: 'Search tasks' }))
      await userEvent.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'beta')
      await userEvent.click(screen.getByRole('button', { name: /In progress 2/ }))
      await userEvent.click(screen.getByRole('button', { name: /Closed 3/ }))
      expect(screen.getByText('No closed tasks match "beta".')).toBeInTheDocument()
    })
  })
})
