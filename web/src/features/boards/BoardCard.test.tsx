import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import BoardCard from './BoardCard'
import { makeIssue } from '../issues/issue.fixture'

function renderCard(issue = makeIssue()) {
  render(<MemoryRouter><BoardCard issue={issue} /></MemoryRouter>)
}

describe('BoardCard', () => {
  it('links to the issue and shows its id, title, priority and status', () => {
    renderCard(makeIssue({ id: 'td-a1b2', title: 'Wire up the thing', priority: 'P1', status: 'in_progress' }))
    expect(screen.getByRole('link', { name: /Wire up the thing/ }))
      .toHaveAttribute('href', '/issues/td-a1b2')
    expect(screen.getByText('td-a1b2')).toBeInTheDocument()
    expect(screen.getByText('P1')).toBeInTheDocument()
    expect(screen.getByText('in_progress')).toBeInTheDocument()
  })

  // Anchors are draggable by default, which would make the link the drag
  // source: the browser seeds the drag data with text/uri-list before our
  // dragstart runs, so dropping a card on browser chrome offers to navigate,
  // and the drag ghost is the link instead of the row. Opting out hands the
  // drag to the draggable <li> the card sits in.
  it('opts the link out of native dragging', () => {
    renderCard(makeIssue({ title: 'Wire up the thing' }))
    expect(screen.getByRole('link', { name: /Wire up the thing/ }))
      .toHaveAttribute('draggable', 'false')
  })

  // td already drops closed blockers from this summary, so every entry is
  // still in the way — the count can be shown without further filtering.
  it('counts unresolved blockers and names them', () => {
    renderCard(makeIssue({
      dependency_summary: {
        blockers: [
          { dep_id: 'dep_1', issue_id: 'td-blk1', title: 'One', status: 'open', relation_type: 'depends_on' },
          { dep_id: 'dep_2', issue_id: 'td-blk2', title: 'Two', status: 'in_progress', relation_type: 'depends_on' },
        ],
      },
    }))
    expect(screen.getByLabelText('Blocked by td-blk1, td-blk2')).toHaveTextContent('2')
  })

  it('shows no blocker badge when the summary is absent', () => {
    renderCard(makeIssue())
    expect(screen.queryByLabelText(/Blocked by/)).not.toBeInTheDocument()
  })
})
