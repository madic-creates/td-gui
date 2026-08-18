import { type ReactNode } from 'react'
import { Link } from 'react-router'
import StatusTag from '../../components/StatusTag'
import PriorityTag from '../../components/PriorityTag'
import IssueGroupHeader from './IssueGroupHeader'
import IssueListHeader from './IssueListHeader'
import { groupByStatus, type Sort } from './ordering'
import { relativeTime } from '../../lib/format'
import { COL, ROW } from './columns'
import type { Issue } from '../../api/types'

interface Props {
  issues: Issue[]
  sort: Sort
  onSortChange: (sort: Sort) => void
  /**
   * True when what is rendered is only part of what the reader asked for, so
   * every group count is a lower bound. Both paths can hit this for different
   * reasons: a capped list fetch, or query hits the index cannot resolve.
   */
  truncated: boolean
  /** Says what is missing and why. Rendered above the column header. */
  notice?: ReactNode
}

/**
 * The list body: a notice bar, the sort header, and the status groups.
 *
 * Shared by both paths into the list — full-text search through /v1/issues,
 * and a TDQ query joined against the index — so that a query result is not a
 * second kind of row with its own drift. Same objects, same grouping, same
 * sort, same markup.
 */
export default function IssueRows({ issues, sort, onSortChange, truncated, notice }: Props) {
  const groups = groupByStatus(issues, sort)
  return (
    <>
      {notice && (
        <p className="border-b border-line bg-surface-inset px-4 py-1.5 text-[11px] text-ink-muted">
          {notice}
        </p>
      )}
      <IssueListHeader sort={sort} onChange={onSortChange} />
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
