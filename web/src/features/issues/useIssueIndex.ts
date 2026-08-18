import { useMemo } from 'react'
import { FETCH_LIMIT, useIssues } from '../../api/queries'
import { indexById } from './issueIndex'
import type { Issue } from '../../api/types'

/**
 * The whole issue list, by id. Dependencies carry only id triples and epic
 * children are not returned at all, so both are resolved against this.
 *
 * The first query is deliberately identical to the one IssueList issues, so
 * react-query serves the previous result from cache instantly on mount —
 * there is no visible loading state — even though `main.tsx`'s bare
 * `QueryClient` has a `staleTime` of 0, so a real request is still fired
 * in the background on every mount. It is also deliberately unfiltered: any
 * status filter narrower than td's own would drop referenced issues out of
 * the index and blank their titles.
 *
 * td reads an absent status filter as everything *except* closed, though, so
 * a second query fetches those. Two requests rather than one asking for all
 * five statuses: that would be a different query key, costing the shared
 * cache entry above, and it would put both halves under a single 1000-issue
 * cap that td fills by priority — where a project's closed P0s would crowd
 * out the open work the reader is actually looking at. Apart, each half has
 * that page to itself.
 *
 * Loading and failure both surface as a smaller index, never an error: the
 * two requests degrade independently, and a lost closed half leaves the open
 * one standing. Titles are enrichment, not the detail view's data, so callers
 * fall back to the bare id rather than reporting something they cannot act on.
 */
export function useIssueIndex(): {
  index: Map<string, Issue>
  issues: Issue[]
  /**
   * True until at least one half has answered. Callers that only enrich a
   * reference can ignore it — a missing title falls back to the id. A caller
   * that reads *absence* as a fact, as the TDQ result count does, cannot: an
   * index that has not loaded yet would report every hit as unresolvable.
   */
  isPending: boolean
} {
  const open = useIssues({ limit: FETCH_LIMIT })
  const closed = useIssues({ status: ['closed'], limit: FETCH_LIMIT })

  // `issues` is derived from the index rather than concatenated alongside it:
  // a Map holds one entry per id, so an issue both halves report — which td
  // does not do today, but only td decides that — reaches the pickers once.
  // Insertion order keeps the open rows ahead of the closed ones, which is
  // the order candidatesFor then preserves within each group.
  const isPending = open.isPending || closed.isPending
  return useMemo(() => {
    const index = indexById([...(open.data?.issues ?? []), ...(closed.data?.issues ?? [])])
    return { index, issues: [...index.values()], isPending }
  }, [open.data, closed.data, isPending])
}
