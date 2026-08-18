import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReviewPanel from './ReviewPanel'
import type { ActiveReview, Review } from '../../api/types'

const active: ActiveReview = {
  id: 'rv-3aee1321', decision: 'approved', reviewer_session: 'ses_a2b123',
  requested_by_session: 'ses_582415', summary: 'Read it end to end',
  created_at: '2026-08-14T15:01:46+02:00', self_review: false,
}

const older = (over: Partial<Review> = {}): Review => ({
  id: 'rv-0000001', issue_id: 'td-6a0883', reviewer_session: 'ses_6075f2',
  decision: 'rejected', summary: 'Missing error handling',
  requested_by_session: 'ses_582415', created_at: '2026-08-13T15:01:46+02:00',
  self_review: false, ...over,
})

describe('ReviewPanel', () => {
  it('shows the standing review with its decision, reviewer and summary', () => {
    render(<ReviewPanel active={active} history={[]} />)

    expect(screen.getByText('approved')).toBeInTheDocument()
    expect(screen.getByText('a2b1')).toBeInTheDocument()
    expect(screen.getByText('Read it end to end')).toBeInTheDocument()
  })

  // td sends no active_review at all before the first one. An empty heading
  // would read as "reviewed, details missing".
  it('renders nothing when the issue has never been reviewed', () => {
    const { container } = render(<ReviewPanel active={undefined} history={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('marks earlier reviews as superseded behind a disclosure', async () => {
    render(<ReviewPanel active={active} history={[older({ id: 'rv-1' }), older({ id: 'rv-2' })]} />)

    // jsdom renders <details> children regardless of the `open` attribute,
    // so asserting on content alone would pass even without the click below.
    // Asserting on `open` proves the disclosure itself, not just its content.
    const details = screen.getByText('2 earlier reviews').closest('details')
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute('open')

    // The history is loaded with the issue, so opening it fetches nothing.
    await userEvent.click(screen.getByText('2 earlier reviews'))

    expect(details).toHaveAttribute('open')
    expect(screen.getAllByText('(superseded)')).toHaveLength(2)
    expect(screen.getAllByText('Missing error handling')).toHaveLength(2)
  })

  it('offers no disclosure when the standing review is the only one', () => {
    render(<ReviewPanel active={active} history={[{ ...older(), id: active.id }]} />)
    expect(screen.queryByText(/earlier review/)).not.toBeInTheDocument()
  })

  it('says so when the reviewer reviewed their own work', () => {
    render(<ReviewPanel active={{ ...active, self_review: true }} history={[]} />)
    expect(screen.getByText('self-reviewed')).toBeInTheDocument()
  })
})

describe('ReviewPanel renders summaries as Markdown', () => {
  it('renders formatting in the standing review summary', () => {
    const summary = 'Rejected because `newMux` drops the `--` separator:\n\n- no test\n- no doc'
    const { container } = render(<ReviewPanel active={{ ...active, summary }} history={[]} />)

    expect(container.querySelector('code')).toHaveTextContent('newMux')
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(screen.queryByText('- no test')).not.toBeInTheDocument()
  })

  it('renders formatting in a superseded review summary', async () => {
    const summary = 'Superseded, see `internal/tdquery`'
    const { container } = render(
      <ReviewPanel active={active} history={[older({ summary })]} />,
    )

    await userEvent.click(screen.getByText(/earlier review/))
    const codes = [...container.querySelectorAll('code')].map(c => c.textContent)
    expect(codes).toContain('internal/tdquery')
  })

  it('does not let a script tag in a summary reach the DOM', () => {
    const summary = 'ok <script>window.pwned = true</script>'
    render(<ReviewPanel active={{ ...active, summary }} history={[]} />)

    expect(document.querySelector('script')).toBeNull()
    expect((window as unknown as { pwned?: boolean }).pwned).toBeUndefined()
  })
})
