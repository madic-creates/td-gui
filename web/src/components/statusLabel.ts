import type { IssueStatus } from '../api/types'

/**
 * td's status vocabulary, spelled for a reader rather than for a wire format.
 *
 * Its own module rather than a second export from StatusTag.tsx: a file that
 * exports both a component and a constant breaks fast refresh, which is the
 * only warning oxlint has to make about this codebase and worth keeping that
 * way. StatusTag renders the raw key on purpose — a status td adds later must
 * still show — so the two are not interchangeable.
 */
export const STATUS_LABEL: Record<IssueStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  in_review: 'In review',
  closed: 'Closed',
}
