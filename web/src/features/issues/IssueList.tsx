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
import IssueGroupHeader from './IssueGroupHeader'
import IssueListHeader from './IssueListHeader'
import { DEFAULT_SORT, groupByStatus, type Sort } from './ordering'
import { relativeTime } from '../../lib/format'
import { COL, ROW } from './columns'

/* td serve cannot sort, so sorting has to happen here — which is only honest
   if we hold the whole result set. 1000 is td's own maximum for `limit`; it
   rejects anything larger outright, so this is the most one request can carry,
   not a number we picked. */
const FETCH_LIMIT = 1000

export default function IssueList() {
  const [params, setParams] = useState<IssueListParams>({ limit: FETCH_LIMIT })
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT)
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
    const groups = groupByStatus(data.issues, sort)
    const truncated = data.total > data.issues.length
    body = (
      <>
        {truncated && (
          <p className="border-b border-line bg-surface-inset px-4 py-1.5 text-[11px] text-ink-muted">
            Showing {data.issues.length} of {data.total} — refine the filters to
            narrow this down.
          </p>
        )}
        <IssueListHeader sort={sort} onChange={setSort} />
        {groups.map(group => (
          <section key={group.status} aria-label={group.status}>
            <IssueGroupHeader
              status={group.status}
              count={group.issues.length}
              truncated={truncated}
            />
            <ul>
              {group.issues.map(issue => (
                <li key={issue.id}>
                  <Link
                    to={`/issues/${issue.id}`}
                    className={`${ROW} hover:bg-surface-hover hover:shadow-[inset_2px_0_0_var(--color-accent)]`}
                  >
                    <span className={`${COL.id} font-mono text-ink-faint`}>{issue.id}</span>
                    <span className={`${COL.title} text-ink`}>{issue.title}</span>
                    <span className={COL.priority}><PriorityTag priority={issue.priority} /></span>
                    <time
                      dateTime={issue.updated_at}
                      title={issue.updated_at}
                      className={`${COL.updated} text-ink-faint`}
                    >
                      {relativeTime(issue.updated_at)}
                    </time>
                    <span className={COL.status}><StatusTag status={issue.status} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
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
