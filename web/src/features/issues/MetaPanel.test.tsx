import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import MetaPanel from './MetaPanel'
import { makeIssue } from './issue.fixture'

const show = (issue = makeIssue()) =>
  render(<MemoryRouter><MetaPanel issue={issue} /></MemoryRouter>)

describe('MetaPanel', () => {
  it('shows the metadata fields that are set', () => {
    show(makeIssue({
      points: 3, labels: ['ui', 'web'], sprint: 'S12',
      due_date: '2026-08-20', defer_until: '2026-08-18', defer_count: 2,
      minor: true, created_branch: 'feat/thing',
    }))

    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('ui, web')).toBeInTheDocument()
    expect(screen.getByText('S12')).toBeInTheDocument()
    expect(screen.getByText('2026-08-20')).toBeInTheDocument()
    expect(screen.getByText('2026-08-18')).toBeInTheDocument()
    expect(screen.getByText('feat/thing')).toBeInTheDocument()
    expect(screen.getByText('Defers')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Minor')).toBeInTheDocument()
    expect(screen.getByText('self-reviewable')).toBeInTheDocument()
  })

  // These three used to be tag chips beside the title and are rows here now,
  // which is what leaves the header as the title and one row of controls.
  it('opens with the type, priority and status the header used to carry', () => {
    show(makeIssue({ type: 'bug', priority: 'P1', status: 'in_progress' }))

    expect(screen.getByText('Type')).toBeInTheDocument()
    expect(screen.getByText('bug')).toBeInTheDocument()
    expect(screen.getByText('Priority')).toBeInTheDocument()
    expect(screen.getByText('P1')).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('in_progress')).toBeInTheDocument()
  })

  // No placeholder rows: an unset field is absent, not an em-dash. A row that
  // says nothing still costs the reader a line to scan. A Block with no set
  // fields must not render its heading either — an empty "Sessions" section is
  // the same lie as an empty row. Metadata is the exception now: its type,
  // priority and status rows are always there, so it always renders.
  it('omits every field the issue does not set, and the section headings that would be empty', () => {
    show(makeIssue({
      points: 0, labels: [], sprint: '', due_date: null,
      defer_until: null, defer_count: 0, minor: false, created_branch: null,
      parent_id: null,
      implementer_session: null, reviewer_session: null,
      creator_session: null, closed_by_session: null,
    }))

    for (const label of ['Points', 'Labels', 'Sprint', 'Due', 'Deferred', 'Defers', 'Branch', 'Parent', 'Minor']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
    expect(screen.queryByText('Sessions')).not.toBeInTheDocument()
    // Metadata keeps its three unconditional rows and Timeline always has
    // Created/Updated, so both still render.
    expect(screen.getByText('Metadata')).toBeInTheDocument()
    expect(screen.getByText('Timeline')).toBeInTheDocument()
  })

  it('links the parent issue', () => {
    show(makeIssue({ parent_id: 'td-epic00' }))
    expect(screen.getByRole('link', { name: 'td-epic00' })).toHaveAttribute('href', '/issues/td-epic00')
  })

  it('shows the sessions that touched the issue, shortened', () => {
    show(makeIssue({
      implementer_session: 'ses_582415',
      reviewer_session: 'ses_a2b123',
      creator_session: 'ses_d87edf',
      closed_by_session: null,
    }))

    expect(screen.getByText('5824')).toBeInTheDocument()
    expect(screen.getByText('a2b1')).toBeInTheDocument()
    expect(screen.getByText('d87e')).toBeInTheDocument()
    expect(screen.queryByText('Closed by')).not.toBeInTheDocument()
  })

  it('shows the timestamps that are set', () => {
    show(makeIssue({
      created_at: '2026-08-14T15:01:46+02:00',
      updated_at: '2026-08-14T15:01:46+02:00',
      reviewed_at: null,
      closed_at: null,
    }))

    expect(screen.getByText('Created')).toBeInTheDocument()
    expect(screen.getByText('Updated')).toBeInTheDocument()
    expect(screen.queryByText('Reviewed')).not.toBeInTheDocument()
    expect(screen.queryByText('Closed')).not.toBeInTheDocument()
  })
})
