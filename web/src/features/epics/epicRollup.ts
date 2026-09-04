import { STATUS_ORDER } from '../issues/ordering'
import type { Issue, IssueStatus } from '../../api/types'

/**
 * Every issue that names a parent, keyed by the parent it names.
 *
 * Built once by the caller and handed in, rather than derived inside `rollup`.
 * `childrenOf` scans the whole list per call, which is fine for the one group
 * the detail view renders — but a transitive walk asks that question once per
 * node it visits, and the overview runs a walk per epic. On the measured
 * project that is thirty walks over forty-nine issues on every SSE refresh;
 * one pass up front makes each walk cost the size of the subtree instead.
 */
export type ChildIndex = Map<string, Issue[]>

export function childIndex(issues: Issue[]): ChildIndex {
  const byParent: ChildIndex = new Map()
  for (const issue of issues) {
    if (!issue.parent_id) continue
    const siblings = byParent.get(issue.parent_id)
    if (siblings) siblings.push(issue)
    else byParent.set(issue.parent_id, [issue])
  }
  return byParent
}

export interface StatusCount {
  /**
   * A plain string, not IssueStatus, for the reason StatusTag takes one: a
   * status td adds later must still be counted and drawn rather than dropped
   * out of a total the reader is asked to trust.
   */
  status: string
  count: number
}

export interface Rollup {
  /** Every descendant, at any depth. */
  total: number
  /**
   * How many of those are closed, and nothing else. Done is td's own answer to
   * whether a task is finished; reading `in_review` or a label as "basically
   * done" would be this GUI inventing a state td does not have.
   */
  done: number
  /**
   * The statuses actually present, so the bar can be segmented. Empty statuses
   * are left out — a zero-width segment is a legend entry with nothing to
   * point at. Ordered the way the issue list groups its own sections, so the
   * two surfaces read left to right the same way.
   */
  buckets: StatusCount[]
}

/**
 * Progress of the whole subtree under `rootId`, transitively.
 *
 * Transitive rather than one level down: depth is 2 in the project this was
 * measured against, but td puts no bound on `parent_id` chains, and "how far
 * has this epic come" is a question about all the work underneath it.
 *
 * An id the index does not hold answers `0/0` rather than failing. That is the
 * same answer as an epic nobody has decomposed yet, which is deliberate — the
 * caller renders "no tasks" either way, and neither case is one this page can
 * tell the reader anything more useful about.
 */
export function rollup(children: ChildIndex, rootId: string): Rollup {
  const counts = new Map<string, number>()
  let total = 0

  // Seeded with the root, which is what makes a ring terminate on its way back
  // round. `candidatesFor` keeps an issue and its direct children out of the
  // parent picker, so a two-step ring cannot be built here — but td's API
  // accepts one, and a walk that trusted the tree to be a tree would hang the
  // render rather than report a wrong number.
  const visited = new Set([rootId])
  const pending = [rootId]

  while (pending.length > 0) {
    for (const child of children.get(pending.pop()!) ?? []) {
      if (visited.has(child.id)) continue
      visited.add(child.id)
      pending.push(child.id)
      total += 1
      counts.set(child.status, (counts.get(child.status) ?? 0) + 1)
    }
  }

  const known = STATUS_ORDER.filter(status => counts.has(status))
  // Map iteration is insertion-ordered, which is what gives "first seen".
  const unknown = [...counts.keys()].filter(
    status => !STATUS_ORDER.includes(status as IssueStatus),
  )

  return {
    total,
    done: counts.get('closed') ?? 0,
    buckets: [...known, ...unknown].map(status => ({ status, count: counts.get(status)! })),
  }
}
