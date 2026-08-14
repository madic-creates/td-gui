import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useIssues, type IssueListParams } from '../../api/queries'
import { ApiError } from '../../api/client'
import type { IssueListResponse } from '../../api/types'
import IssueFilters from './IssueFilters'
import StatusTag from '../../components/StatusTag'
import PriorityTag from '../../components/PriorityTag'
import ErrorPanel from '../../components/ErrorPanel'
import EmptyState from '../../components/EmptyState'
import SkeletonRows from '../../components/SkeletonRows'

const PAGE_SIZE = 50

interface PaginationProps {
  data: IssueListResponse
  onPrev: () => void
  onNext: () => void
}

// Shared by the populated and (offset > 0) empty states so "prev" stays
// reachable if a live update shrinks the list out from under the current
// page — see the range-text guard for the "no rows on this page" case.
// Driven by the server-confirmed `data.offset`, not local UI state, so it
// always reflects the page the current response actually represents.
function Pagination({ data, onPrev, onNext }: PaginationProps) {
  const range = data.issues.length === 0
    ? `0 of ${data.total}`
    : `${data.offset + 1}–${data.offset + data.issues.length} of ${data.total}`

  return (
    <div className="flex items-center gap-3.5 px-4 py-2.5 text-[11px] text-ink-muted">
      <button
        className="rounded-sm border border-line px-2.5 py-1 disabled:opacity-40"
        disabled={data.offset === 0}
        onClick={onPrev}
      >
        prev
      </button>
      <span>{range}</span>
      <button
        className="rounded-sm border border-line px-2.5 py-1 disabled:opacity-40"
        disabled={!data.has_more}
        onClick={onNext}
      >
        next
      </button>
    </div>
  )
}

export default function IssueList() {
  const [params, setParams] = useState<IssueListParams>({ limit: PAGE_SIZE, offset: 0 })
  const { data, error, isPending } = useIssues(params)

  const goPrev = () => setParams(p => ({ ...p, offset: Math.max(0, p.offset - PAGE_SIZE) }))
  const goNext = () => setParams(p => ({ ...p, offset: p.offset + PAGE_SIZE }))

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
    // A stale offset (e.g. another session closed issues while this tab held
    // a later page) can leave the list empty on a page that isn't page one.
    // Keep pagination mounted then so "prev" stays reachable — a genuinely
    // empty project at offset 0 stays quiet instead of showing "0 of 0".
    body = (
      <>
        <EmptyState
          message="No issues found."
          hint="Try clearing the status filters, or create the first issue."
        />
        {data.offset > 0 && (
          <Pagination data={data} onPrev={goPrev} onNext={goNext} />
        )}
      </>
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

        <Pagination data={data} onPrev={goPrev} onNext={goNext} />
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
