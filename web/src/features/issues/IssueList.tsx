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

const PAGE_SIZE = 50

export default function IssueList() {
  const [params, setParams] = useState<IssueListParams>({ limit: PAGE_SIZE, offset: 0 })
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
        <ul>
          {data.issues.map(issue => (
            <li key={issue.id} className="border-b border-line-subtle">
              <Link
                to={`/issues/${issue.id}`}
                className="flex items-center gap-3 px-4 py-2 hover:bg-surface-hover hover:shadow-[inset_2px_0_0_var(--color-accent)]"
              >
                <span className="w-[74px] shrink-0 text-ink-faint">{issue.id}</span>
                <span className="flex-1 truncate text-ink">{issue.title}</span>
                <PriorityTag priority={issue.priority} />
                <span className="w-[74px] shrink-0 text-right">
                  <StatusTag status={issue.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3.5 px-4 py-2.5 text-[11px] text-ink-muted">
          <button
            className="rounded-sm border border-line px-2.5 py-1 disabled:opacity-40"
            disabled={params.offset === 0}
            onClick={() => setParams(p => ({ ...p, offset: Math.max(0, p.offset - PAGE_SIZE) }))}
          >
            prev
          </button>
          <span>
            {data.offset + 1}–{data.offset + data.issues.length} of {data.total}
          </span>
          <button
            className="rounded-sm border border-line px-2.5 py-1 disabled:opacity-40"
            disabled={!data.has_more}
            onClick={() => setParams(p => ({ ...p, offset: p.offset + PAGE_SIZE }))}
          >
            next
          </button>
        </div>
      </>
    )
  }

  return (
    <div>
      <IssueFilters params={params} onChange={next => setParams({ ...next, offset: 0 })} />
      {body}
    </div>
  )
}
