import type { Dependency, Issue } from '../../api/types'

/**
 * A reference to another issue, looked up or not. `issue` is null when the
 * index does not hold it: the list fetch was capped, or the issue was deleted.
 * Both mean the title is unknown, and the caller renders the bare id.
 */
export interface Related {
  id: string
  issue: Issue | null
}

export function indexById(issues: Issue[]): Map<string, Issue> {
  return new Map(issues.map(issue => [issue.id, issue]))
}

/**
 * Resolves one end of each dependency row. One row appears on both issues it
 * connects, so which end to read depends on which issue is being viewed:
 * `depends_on_id` is what this issue waits for (td's BLOCKED BY), `issue_id`
 * is what waits on it (td's BLOCKS). Note that the API field named
 * `blocked_by` carries the latter — see the spec.
 */
export function resolve(
  deps: Dependency[],
  index: Map<string, Issue>,
  key: 'depends_on_id' | 'issue_id',
): Related[] {
  return deps.map(dep => ({ id: dep[key], issue: index.get(dep[key]) ?? null }))
}

/** Epic children exist only as `parent_id` on the children; no endpoint lists them. */
export function childrenOf(issues: Issue[], parentId: string): Issue[] {
  return issues.filter(issue => issue.parent_id === parentId)
}

/**
 * A closed blocker no longer blocks. An unresolved reference does not count as
 * resolved: unknown is not done, and filing it under "resolved" would hide a
 * dependency that may well still be open.
 */
export const isResolved = (related: Related): boolean =>
  related.issue?.status === 'closed'

/**
 * The issues offerable as a link target: everything the index holds minus the
 * ids the caller rules out — the issue itself, and whatever it already links.
 *
 * Closed issues stay in the list because linking one is legitimate, but they
 * sort last: what a reader reaches for is nearly always still open. Within
 * each group the caller's order survives untouched.
 */
export function candidatesFor(issues: Issue[], exclude: Iterable<string>): Issue[] {
  const skip = new Set(exclude)
  const open: Issue[] = []
  const closed: Issue[] = []
  for (const issue of issues) {
    if (skip.has(issue.id)) continue
    if (issue.status === 'closed') closed.push(issue)
    else open.push(issue)
  }
  return [...open, ...closed]
}
