import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { useIssues, type IssueListParams } from '../../api/queries'
import { ApiError } from '../../api/client'
import IssueFilters from './IssueFilters'
import ErrorPanel from '../../components/ErrorPanel'
import EmptyState from '../../components/EmptyState'
import SkeletonRows from '../../components/SkeletonRows'
import IssueRows from './IssueRows'
import QueryResults from './QueryResults'
import { type Sort } from './ordering'
import { readListUrl, writeListUrl } from './listUrl'

/**
 * The list state lives in the url, not in this component.
 *
 * Opening an issue unmounts the list, so state held here is state the reader
 * loses on the way back. In the address bar it survives that, a reload, and a
 * link sent to someone else, and the browser's back button lands on the list
 * that was left rather than an unfiltered one.
 *
 * Every write replaces: the search box is debounced, and pushing one entry
 * per typing pause would bury the issue the reader came from under a stack of
 * half-typed searches.
 */
export default function IssueList() {
  const [search, setSearch] = useSearchParams()
  const { params, sort, board } = useMemo(() => readListUrl(search), [search])

  /**
   * `board` defaults to the one already in the url, so editing a query keeps
   * the board it was loaded from and the bar can offer to write the change
   * back. Leaving query mode needs no special case: `writeListUrl` drops a
   * board that has no query to belong to.
   */
  const apply = (nextParams: IssueListParams, nextSort: Sort, nextBoard = board) =>
    setSearch(writeListUrl(nextParams, nextSort, nextBoard), { replace: true })

  // The filters stay mounted in every state, including the two error and
  // empty ones below — the hint tells the reader to clear them, so the
  // control it names has to be on screen.
  return (
    <div>
      <IssueFilters
        params={params}
        board={board}
        onChange={next => apply(next, sort)}
        onPick={(query, picked) =>
          apply({ ...params, query, search: undefined }, sort, picked)}
        onSaved={saved => apply(params, sort, saved)}
      />
      {params.query === undefined ? (
        <SearchResults
          params={params}
          sort={sort}
          onSortChange={next => apply(params, next)}
        />
      ) : (
        <QueryResults
          params={{ ...params, query: params.query }}
          sort={sort}
          onSortChange={next => apply(params, next)}
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
