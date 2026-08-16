import { useEffect, useRef } from 'react'
import { useIssue } from '../../api/queries'
import { unboundMessage } from '../../api/client'
import ErrorPanel from '../../components/ErrorPanel'
import SkeletonRows from '../../components/SkeletonRows'
import TransitionBar from '../issues/TransitionBar'
import { STATUS_LABEL } from '../../components/statusLabel'
import type { IssueStatus } from '../../api/types'

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
  const dialogRef = useRef<HTMLDivElement>(null)

  // A drop does not move DOM focus itself, so without this a keyboard user
  // could only dismiss the panel by hunting down the Close button with the
  // mouse — Escape would never reach a handler nothing has focused.
  //
  // Taking focus obliges us to give it back: unmounting the focused element
  // drops focus to <body> and restarts the tab order, and Escape is exactly
  // when a keyboard user is about to keep going from where they were.
  useEffect(() => {
    const previous = document.activeElement
    dialogRef.current?.focus()
    return () => {
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label={`Move ${issueId}`}
      tabIndex={-1}
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

      {/* One row inside an inline panel: what is being waited for is the
          issue's transitions, not a list. */}
      {isPending && <SkeletonRows label="Loading transitions" rows={1} />}
      {error && <ErrorPanel message={unboundMessage(error) ?? 'Request failed'} />}
      {data && (
        data.issue.available_transitions?.length ? (
          // The rule used to live on TransitionBar itself, separating its
          // buttons from the "Dropped on" row above. TransitionBar dropped
          // it — there it is the fourth row of the issue detail header, not
          // a section — but this panel still needs the separation, so it
          // moves here. pt-2, not pt-4: padding blocks margin collapse, and
          // TransitionBar's own wrapper already carries mt-2 — pt-4 here
          // would stack to a 24px gap where 16px is the rest of the app's rhythm.
          <div className="mt-4 border-t border-line-subtle pt-2">
            <TransitionBar
              issueId={issueId}
              available={data.issue.available_transitions}
              // The panel exists to ask one question. Once td has answered it,
              // there is nothing left to choose here — and closing is the
              // acknowledgement the user would otherwise never get.
              onDone={onClose}
            />
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-ink-faint">
            td reports no transitions available for {issueId}.
          </p>
        )
      )}
    </div>
  )
}
