import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import RelatedIssues from './RelatedIssues'
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
})
