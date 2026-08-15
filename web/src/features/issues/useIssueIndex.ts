import { useMemo } from 'react'
import { FETCH_LIMIT, useIssues } from '../../api/queries'
import { indexById } from './issueIndex'
import type { Issue } from '../../api/types'

/**
 * The whole issue list, by id. Dependencies carry only id triples and epic
 * children are not returned at all, so both are resolved against this.
 *
 * The query is deliberately identical to the one IssueList issues, so
 * react-query serves the previous result from cache instantly on mount —
 * there is no visible loading state — even though `main.tsx`'s bare
 * `QueryClient` has a `staleTime` of 0, so a real request is still fired
 * in the background on every mount. It is also deliberately unfiltered: a
 * status filter on the list would drop referenced issues out of the index
 * and blank their titles.
 *
 * Loading and failure both surface as an empty index. Titles are enrichment,
 * not the detail view's data, so callers fall back to the bare id rather than
 * reporting an error the reader cannot act on.
 */
export function useIssueIndex(): { index: Map<string, Issue>; issues: Issue[] } {
  const { data } = useIssues({ limit: FETCH_LIMIT })
  const issues = data?.issues ?? []
  // `issues` is derived from `data` on every render; only the query result
  // should rebuild the map.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ index: indexById(issues), issues }), [data])
}
