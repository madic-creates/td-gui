import { useIssue } from '../../api/queries'
import { unboundMessage } from '../../api/client'
import ErrorPanel from '../../components/ErrorPanel'
import SkeletonRows from '../../components/SkeletonRows'
import TransitionBar from '../issues/TransitionBar'
import type { IssueStatus } from '../../api/types'

export const STATUS_LABEL: Record<IssueStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  in_review: 'In review',
  closed: 'Closed',
}

interface Props {
  issueId: string
  droppedOn: IssueStatus
  onClose: () => void
}

/**
 * What a cross-column drop opens.
 *
 * It deliberately does not infer an action from the target column: `closed`
 * follows both approve and close, `open` follows reopen, reject and unblock,
 * and td publishes no transition-to-status table. The column is stated, the
 * choice stays with the actions td itself reported — which is also why the
 * issue has to be fetched, since board cards carry no available_transitions.
 */
export default function BoardTransitionPanel({ issueId, droppedOn, onClose }: Props) {
  const { data, error, isPending } = useIssue(issueId)

  return (
    <div
      role="dialog"
      aria-label={`Move ${issueId}`}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}
      className="border-t border-line bg-surface-inset px-4 py-3"
    >
      <div className="flex items-center gap-2.5">
        <p className="text-[11px] uppercase tracking-widest text-ink-muted">
          Dropped on: {STATUS_LABEL[droppedOn]}
        </p>
        <span className="flex-1" />
        <button
          type="button" onClick={onClose}
          className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted"
        >
          Close
        </button>
      </div>

      {isPending && <SkeletonRows />}
      {error && <ErrorPanel message={unboundMessage(error) ?? 'Request failed'} />}
      {data && (
        data.issue.available_transitions?.length ? (
          <TransitionBar issueId={issueId} available={data.issue.available_transitions} />
        ) : (
          <p className="mt-2 text-[11px] text-ink-faint">
            td reports no transitions available for {issueId}.
          </p>
        )
      )}
    </div>
  )
}
