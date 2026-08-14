import type { Issue } from '../../api/types'

/** A complete, boring Issue. Tests override only the fields they care about. */
export function makeIssue(over: Partial<Issue> = {}): Issue {
  return {
    id: 'td-000000',
    title: 'An issue',
    description: '',
    status: 'open',
    type: 'feature',
    priority: 'P2',
    points: 0,
    labels: [],
    parent_id: null,
    acceptance: '',
    sprint: '',
    implementer_session: null,
    creator_session: 'ses_d87edf',
    reviewer_session: null,
    review_requested_by_session: null,
    closed_by_session: null,
    created_at: '2026-08-14T15:01:46+02:00',
    updated_at: '2026-08-14T15:01:46+02:00',
    reviewed_at: null,
    closed_at: null,
    deleted_at: null,
    minor: false,
    created_branch: null,
    defer_until: null,
    due_date: null,
    defer_count: 0,
    ...over,
  }
}
