import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useIssues, type IssueListParams } from '../../api/queries'
import { ApiError } from '../../api/client'
import IssueFilters from './IssueFilters'
import StatusTag from '../../components/StatusTag'
import PriorityTag from '../../components/PriorityTag'
import ErrorPanel from '../../components/ErrorPanel'
import EmptyState from '../../components/EmptyState'
import SkeletonRows from '../../components/SkeletonRows'
import { COL, ROW } from './columns'

/* td serve cannot sort, so sorting has to happen here — which is only honest
   if we hold the whole result set. One request against a local database is
   cheaper than the round trips it replaces. */
const FETCH_LIMIT = 500

export default function IssueList() {
  const [params, setParams] = useState<IssueListParams>({ limit: FETCH_LIMIT })
  const { data, error, isPending } = useIssues(params)

  // Assigned rather than early-returned so the filters stay mounted in every
  // state — the empty-state hint tells the user to clear them.
  let body: ReactNode
  if (isPending) {
    body = <SkeletonRows />
  } else if (error) {
    body = (
      <div className="p-4">
        <ErrorPanel message={error instanceof ApiError ? error.message : String(error)} />
      </div>
    )
  } else if (data.issues.length === 0) {
    body = (
      <EmptyState
        message="No issues found."
        hint="Try clearing the status filters, or create the first issue."
      />
    )
  } else {
    body = (
      <>
        {data.total > data.issues.length && (
          <p className="border-b border-line bg-surface-inset px-4 py-1.5 text-[11px] text-ink-muted">
            Showing {data.issues.length} of {data.total} — refine the filters to
            narrow this down.
          </p>
        )}
        <ul>
          {/* rows unchanged for now; Task 7 replaces this block */}
          {data.issues.map(issue => (
            <li key={issue.id}>
              <Link
                to={`/issues/${issue.id}`}
                className={`${ROW} hover:bg-surface-hover hover:shadow-[inset_2px_0_0_var(--color-accent)]`}
              >
                <span className={`${COL.id} font-mono text-ink-faint`}>{issue.id}</span>
                <span className={`${COL.title} text-ink`}>{issue.title}</span>
                <span className={COL.priority}><PriorityTag priority={issue.priority} /></span>
                <span className={COL.status}><StatusTag status={issue.status} /></span>
              </Link>
            </li>
          ))}
        </ul>
      </>
    )
  }

  return (
    <div>
      <IssueFilters params={params} onChange={setParams} />
      {body}
    </div>
  )
}
