import type { Issue, IssueStatus, Priority } from '../../api/types'

/** Values, not only a type: the url has to be checked against them at runtime. */
export const SORT_KEYS = ['id', 'title', 'priority', 'updated'] as const
export const SORT_DIRECTIONS = ['asc', 'desc'] as const

export type SortKey = (typeof SORT_KEYS)[number]
export type SortDirection = (typeof SORT_DIRECTIONS)[number]

export interface Sort {
  key: SortKey
  direction: SortDirection
}

/** Priority ascending is the order td serve already returns, so the first
    render looks the way it did before this feature existed. */
export const DEFAULT_SORT: Sort = { key: 'priority', direction: 'asc' }

const PRIORITY_ORDER: Priority[] = ['P0', 'P1', 'P2', 'P3', 'P4']

/** null means "cannot be ordered on this key" — those rows go last. */
function rank(issue: Issue, key: SortKey): number | null {
  if (key !== 'priority' && key !== 'updated') return 0
  if (key === 'priority') {
    const index = PRIORITY_ORDER.indexOf(issue.priority)
    return index === -1 ? null : index
  }
  const time = new Date(issue.updated_at).getTime()
  return Number.isNaN(time) ? null : time
}

function compare(a: Issue, b: Issue, key: SortKey): number {
  switch (key) {
    case 'id':
      return a.id.localeCompare(b.id)
    case 'title':
      return a.title.localeCompare(b.title)
    default:
      return (rank(a, key) as number) - (rank(b, key) as number)
  }
}

const byId = (a: Issue, b: Issue) => a.id.localeCompare(b.id)

/**
 * Sorts a copy. Rows that cannot be ordered on the chosen key — an
 * unrecognised priority, an unparseable timestamp — are partitioned out and
 * appended, so they stay last whichever direction is chosen instead of
 * flipping to the top. Every comparison falls back to the id, which makes the
 * result a total order: without it an SSE refetch could reshuffle equal rows
 * and the list would twitch under the user.
 */
export function sortIssues(issues: Issue[], sort: Sort): Issue[] {
  const factor = sort.direction === 'asc' ? 1 : -1
  const sortable: Issue[] = []
  const unsortable: Issue[] = []
  for (const issue of issues) {
    if (rank(issue, sort.key) === null) unsortable.push(issue)
    else sortable.push(issue)
  }

  sortable.sort((a, b) => compare(a, b, sort.key) * factor || byId(a, b))
  unsortable.sort(byId)
  return [...sortable, ...unsortable]
}

/** Attention order, not alphabetical: what is moving comes before what is not. */
export const STATUS_ORDER: IssueStatus[] = [
  'in_progress', 'open', 'in_review', 'blocked', 'closed',
]

export interface IssueGroup {
  /** A plain string, not IssueStatus: a status td adds later must still render. */
  status: string
  issues: Issue[]
}

/**
 * Buckets issues by status and sorts within each bucket. Empty statuses are
 * omitted — an empty `blocked` section is noise. A status we do not recognise
 * gets its own group after the known ones, in first-seen order: an issue must
 * never disappear from the list because td grew a status we have not heard of.
 */
export function groupByStatus(issues: Issue[], sort: Sort): IssueGroup[] {
  const buckets = new Map<string, Issue[]>()
  for (const issue of issues) {
    const bucket = buckets.get(issue.status)
    if (bucket) bucket.push(issue)
    else buckets.set(issue.status, [issue])
  }

  const known = STATUS_ORDER.filter(status => buckets.has(status))
  // Map iteration is insertion-ordered, which is what gives "first seen".
  const unknown = [...buckets.keys()].filter(
    status => !STATUS_ORDER.includes(status as IssueStatus),
  )

  return [...known, ...unknown].map(status => ({
    status,
    issues: sortIssues(buckets.get(status)!, sort),
  }))
}
