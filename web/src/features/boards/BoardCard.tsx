import { Link } from 'react-router'
import StatusTag from '../../components/StatusTag'
import PriorityTag from '../../components/PriorityTag'
import type { Issue } from '../../api/types'

/**
 * One card, shared by both board views. The issue arrives without description
 * and acceptance — td slims them out of the board payload — so nothing here
 * may depend on them.
 *
 * The card sits inside a draggable <li> in both views. The link must opt out
 * of native anchor dragging or it becomes the drag source itself: the browser
 * would seed the drag data with the issue URL as text/uri-list before our
 * dragstart handler runs, so a card dropped on browser chrome offers to
 * navigate, and the drag ghost would be the link rather than the whole row.
 *
 * `showStatus` is what swimlanes turn off: their column heading already names
 * the status, so the tag would only repeat it. The backlog mixes statuses in
 * one list and needs it, hence the default.
 */
export default function BoardCard({ issue, showStatus = true }: { issue: Issue; showStatus?: boolean }) {
  const blockers = issue.dependency_summary?.blockers ?? []
  return (
    <Link
      to={`/issues/${issue.id}`}
      draggable={false}
      className="flex items-center gap-2.5 rounded-sm border border-line bg-surface-inset px-2.5 py-2 hover:bg-surface-hover"
    >
      <span className="w-[74px] shrink-0 font-mono text-[11px] text-ink-faint">{issue.id}</span>
      <span className="flex-1 truncate text-ink">{issue.title}</span>
      {blockers.length > 0 && (
        <span
          aria-label={`Blocked by ${blockers.map(b => b.issue_id).join(', ')}`}
          title={blockers.map(b => `${b.issue_id} ${b.title}`).join('\n')}
          className="shrink-0 font-mono text-[11px] text-danger"
        >
          <span aria-hidden="true">⛔</span> {blockers.length}
        </span>
      )}
      <span className="shrink-0 text-[11px]"><PriorityTag priority={issue.priority} /></span>
      {showStatus && <span className="shrink-0"><StatusTag status={issue.status} /></span>}
    </Link>
  )
}
