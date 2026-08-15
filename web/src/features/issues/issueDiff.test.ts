import { describe, expect, it } from 'vitest'
import { diffIssue, draftFrom, isEmptyPatch } from './issueDiff'
import type { Issue } from '../../api/types'

const issue: Issue = {
  id: 'td-6a0883', title: 'Probe issue for API shape', description: 'A description',
  status: 'open', type: 'feature', priority: 'P1', points: 5, labels: ['alpha', 'beta'],
  parent_id: 'td-5206e8', acceptance: 'must work', sprint: 'S1',
  implementer_session: null, creator_session: null, reviewer_session: null,
  review_requested_by_session: null, closed_by_session: null,
  created_at: '2026-08-14T15:01:46+02:00', updated_at: '2026-08-14T15:04:10+02:00',
  reviewed_at: null, closed_at: null, deleted_at: null, minor: false,
  created_branch: null, defer_until: '2026-08-20', due_date: '2026-09-01',
  defer_count: 0,
}

describe('diffIssue', () => {
  it('omits every field when nothing was edited', () => {
    const patch = diffIssue(issue, draftFrom(issue))
    expect(patch).toEqual({})
    expect(isEmptyPatch(patch)).toBe(true)
  })

  it('sends only the fields that changed', () => {
    const draft = { ...draftFrom(issue), title: 'A different title entirely' }
    expect(diffIssue(issue, draft)).toEqual({ title: 'A different title entirely' })
  })

  // td treats null as "field absent" and leaves the value alone. Only an empty
  // string clears. This is the assumption the whole feature rests on.
  it('clears dates with an empty string, never null', () => {
    const draft = { ...draftFrom(issue), due_date: '', defer_until: '' }
    expect(diffIssue(issue, draft)).toEqual({ due_date: '', defer_until: '' })
  })

  it('clears parent_id with an empty string', () => {
    const draft = { ...draftFrom(issue), parent_id: '' }
    expect(diffIssue(issue, draft)).toEqual({ parent_id: '' })
  })

  // "" would fail as a JSON unmarshal error carrying no field details, so an
  // empty points input has to become 0.
  it('clears points with 0, never an empty string', () => {
    const draft = { ...draftFrom(issue), points: null }
    expect(diffIssue(issue, draft)).toEqual({ points: 0 })
  })

  it('treats an unparseable points entry as no change', () => {
    const draft = { ...draftFrom(issue), points: Number.NaN }
    expect(diffIssue(issue, draft)).toEqual({})
  })

  it('clears labels with an empty array', () => {
    const draft = { ...draftFrom(issue), labels: [] }
    expect(diffIssue(issue, draft)).toEqual({ labels: [] })
  })

  it('sends labels when one is added', () => {
    const draft = { ...draftFrom(issue), labels: ['alpha', 'beta', 'gamma'] }
    expect(diffIssue(issue, draft)).toEqual({ labels: ['alpha', 'beta', 'gamma'] })
  })

  it('reads null issue fields as empty strings so an untouched draft is clean', () => {
    const blank: Issue = { ...issue, parent_id: null, defer_until: null, due_date: null, points: 0 }
    expect(diffIssue(blank, draftFrom(blank))).toEqual({})
  })

  it('sends the boolean and enum fields when toggled', () => {
    const draft = { ...draftFrom(issue), minor: true, type: 'bug' as const, priority: 'P0' as const }
    expect(diffIssue(issue, draft)).toEqual({ minor: true, type: 'bug', priority: 'P0' })
  })
})
