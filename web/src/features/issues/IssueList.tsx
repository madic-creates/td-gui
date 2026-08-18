import { useState } from 'react'
import { useIssues, FETCH_LIMIT, type IssueListParams } from '../../api/queries'
import { ApiError } from '../../api/client'
import IssueFilters from './IssueFilters'
import ErrorPanel from '../../components/ErrorPanel'
import EmptyState from '../../components/EmptyState'
import SkeletonRows from '../../components/SkeletonRows'
import IssueRows from './IssueRows'
import QueryResults from './QueryResults'
import { DEFAULT_SORT, type Sort } from './ordering'

export default function IssueList() {
  const [params, setParams] = useState<IssueListParams>({ limit: FETCH_LIMIT })
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT)

  // The filters stay mounted in every state, including the two error and
  // empty ones below — the hint tells the reader to clear them, so the
  // control it names has to be on screen.
  return (
    <div>
      <IssueFilters params={params} onChange={setParams} />
      {params.query === undefined ? (
        <SearchResults params={params} sort={sort} onSortChange={setSort} />
      ) : (
        <QueryResults
          params={{ ...params, query: params.query }}
          sort={sort}
          onSortChange={setSort}
        />
      )}
    </div>
  )
}

interface ResultsProps {
  params: IssueListParams
  sort: Sort
  onSortChange: (sort: Sort) => void
}

/** The list, for td's full-text search and the status filters. */
function SearchResults({ params, sort, onSortChange }: ResultsProps) {
  const { data, error, isPending } = useIssues(params)

  if (isPending) return <SkeletonRows />

  if (error) {
    return (
      <div className="p-4">
        <ErrorPanel message={error instanceof ApiError ? error.message : String(error)} />
      </div>
    )
  }

  if (data.issues.length === 0) {
    return (
      <EmptyState
        message="No issues found."
        hint="Try clearing the status filters, or create the first issue."
      />
    )
  }

  const truncated = data.total > data.issues.length
  return (
    <IssueRows
      issues={data.issues}
      sort={sort}
      onSortChange={onSortChange}
      truncated={truncated}
      notice={
        truncated && (
          <>
            Showing {data.issues.length} of {data.total} — refine the filters to
            narrow this down.
          </>
        )
      }
    />
  )
}
