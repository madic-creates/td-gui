import { useQueryIds, type IssueListParams } from '../../api/queries'
import { ApiError } from '../../api/client'
import ErrorPanel from '../../components/ErrorPanel'
import EmptyState from '../../components/EmptyState'
import SkeletonRows from '../../components/SkeletonRows'
import IssueRows from './IssueRows'
import { useIssueIndex } from './useIssueIndex'
import type { Sort } from './ordering'

interface Props {
  /** `params.query` is what runs; the status chips trim what comes back. */
  params: IssueListParams & { query: string }
  sort: Sort
  onSortChange: (sort: Sort) => void
}

/**
 * The list, for a TDQ query.
 *
 * The query defines the set and the chips trim it, in that order: td decided
 * which issues match, and narrowing the answer afterwards is a client-side
 * filter, not a second query. Toggling a chip therefore starts no process.
 *
 * The join is against the index rather than a second fetch. `td query` hands
 * back ids; the issue objects they name are already in react-query's cache
 * for the most part, because the search path and IssueDetail both pull the
 * same two list queries.
 */
export default function QueryResults({ params, sort, onSortChange }: Props) {
  const { data, error, isPending } = useQueryIds(params.query)
  const index = useIssueIndex()

  if (isPending || index.isPending) return <SkeletonRows />

  if (error) {
    // No link to the grammar here: IssueFilters already shows one directly
    // under the input, which is where the reader's eye and cursor are, and
    // it stays on screen for as long as the box holds a query.
    return (
      <div className="p-4">
        <ErrorPanel
          label="Query failed"
          message={error instanceof ApiError ? error.message : String(error)}
        />
      </div>
    )
  }

  // An id the index cannot resolve is a real result, just not one we hold —
  // the index caps at 1000 issues per half, and a query has no such cap. It
  // is counted rather than dropped, so the row count never quietly disagrees
  // with what `td query` would print.
  const matched = data.ids.map(id => index.index.get(id)).filter(issue => issue !== undefined)
  const missing = data.ids.length - matched.length

  if (data.ids.length === 0) {
    return (
      <EmptyState
        message="No issues match this query."
        hint="Widen it, or drop the leading ? to search the text instead."
      />
    )
  }

  // The chips narrow what the query already decided. Applied here rather than
  // handed to td, so a chip toggle costs no subprocess.
  const shown = params.status
    ? matched.filter(issue => params.status!.includes(issue.status))
    : matched

  if (shown.length === 0) {
    return (
      <EmptyState
        message="No issues match this query."
        hint={
          missing > 0
            ? `${missing} matching ${missing === 1 ? 'issue is' : 'issues are'} outside the loaded set.`
            : 'Try clearing the status filters.'
        }
      />
    )
  }

  return (
    <IssueRows
      issues={shown}
      sort={sort}
      onSortChange={onSortChange}
      truncated={missing > 0}
      /* `shown.length`, not `matched.length`: the bar renders directly above
         these rows, so it has to count the rows it sits on. With a chip active
         the two differ, and a bar reading "Showing 2 of 3" over one row is the
         quiet disagreement the count exists to prevent. Both clauses stay
         individually true — the rest of the gap is the chips, which are on
         screen and lit while they narrow the answer. */
      notice={
        missing > 0 && (
          <>
            Showing {shown.length} of {data.ids.length} —{' '}
            {missing === 1 ? '1 result is' : `${missing} results are`} outside the
            loaded set.
          </>
        )
      }
    />
  )
}
