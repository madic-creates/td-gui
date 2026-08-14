import type { Issue, Priority } from '../../api/types'

export type SortKey = 'id' | 'title' | 'priority' | 'updated'
export type SortDirection = 'asc' | 'desc'

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
