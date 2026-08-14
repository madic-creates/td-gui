import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import IssueGroupHeader from './IssueGroupHeader'

describe('IssueGroupHeader', () => {
  it('names the status and states how many issues are in it', () => {
    render(<IssueGroupHeader status="in_progress" count={3} />)
    expect(screen.getByText('in_progress')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders an unknown status verbatim rather than hiding the group', () => {
    render(<IssueGroupHeader status="archived" count={1} />)
    expect(screen.getByText('archived')).toBeInTheDocument()
  })
})
