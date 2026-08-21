import { useRef, useState } from 'react'
import { unboundMessage } from '../../api/client'
import { useRecordReview, useTransition, type Attribution } from '../../api/mutations'
import ErrorPanel from '../../components/ErrorPanel'
import type { Transition } from '../../api/types'
import { AttributionFieldset, ReasonField } from './TransitionInputs'
import {
  attributionIncomplete, attributionOf, takesReason, transitionLabels, type ApproveMode,
} from './transitions'

const tone: Partial<Record<Transition, string>> = {
  approve: 'border-success/40 text-success',
  reject: 'border-danger/40 text-danger',
  block: 'border-danger/40 text-danger',
}

interface Props {
  issueId: string
  /** Absent means td did not tell us — render nothing rather than guess. */
  available?: Transition[]
  /**
   * Fires once td has accepted a transition or recorded a review. For a host
   * that exists only to ask the question — the board's transition panel —
   * that is the cue to dismiss itself. The issue detail page has no such cue
   * to take and leaves it absent.
   */
  onDone?: () => void
}

export default function TransitionBar({ issueId, available, onDone }: Props) {
  const transition = useTransition(issueId)
  const record = useRecordReview(issueId)
  const [pending, setPending] = useState<Transition | null>(null)
  const [reason, setReason] = useState('')
  const [mode, setMode] = useState<ApproveMode>('independent')
  const [reviewedBy, setReviewedBy] = useState('')
  const [recordOnly, setRecordOnly] = useState(false)

  // Which of the two mutations owns the panel. Selecting the outcome this way
  // rather than reset()ing the sibling matters: MutationObserver.reset()
  // detaches the observer from a *pending* mutation, so td's answer never
  // arrives — and here that answer is a policy rejection the user has to read.
  // See IssueActions and DependencyPanel for the same pattern.
  const [lastAction, setLastAction] = useState<'transition' | 'record' | null>(null)

  // submit()'s button disables on `busy` (mutation.isPending), but dispatching
  // `submit` on the form bypasses that: two submits landing before a render
  // commits both read busy as false and both mutate. A ref isn't tied to
  // render timing, so it closes that gap. Same fix as IssueForm/IssueEditForm/
  // CommentForm. (The plain action buttons above don't need this: a disabled
  // <button> blocks its own next click natively, so there's no window there.)
  const submitting = useRef(false)

  if (!available?.length) return null

  const busy = transition.isPending || record.isPending
  const incomplete = pending === 'approve' && attributionIncomplete(mode, reviewedBy)
  const error =
    lastAction === 'transition' ? transition.error
    : lastAction === 'record' ? record.error
    : null
  const panelError = unboundMessage(error)

  /**
   * Empties the shared form. Every field belongs to the action that opened it —
   * `recordOnly` most sharply, because its checkbox unmounts with the approve
   * fieldset and a leftover `true` would silently record an approval on
   * whatever action came next.
   */
  const resetForm = () => {
    setReason('')
    setMode('independent')
    setReviewedBy('')
    setRecordOnly(false)
    // Both mutations feed one panel, so a settled failure must not outlive its
    // form. A request still in flight has no stale outcome yet — dismissing the
    // form is not a way to un-ask td, and its reply keeps its claim on the panel.
    if (!busy) setLastAction(null)
  }

  const open = (action: Transition) => {
    resetForm()
    setPending(action)
  }

  const close = () => {
    resetForm()
    setPending(null)
  }

  /** What td accepting an action means here: the form goes, and the host — if
   *  it asked to be told — learns the question has been answered. */
  const done = () => {
    close()
    onDone?.()
  }

  const attribution = (): Omit<Attribution, 'reason'> =>
    pending === 'approve' ? attributionOf(mode, reviewedBy) : {}

  const submit = () => {
    if (submitting.current || incomplete) return
    submitting.current = true
    const note = reason.trim()
    if (recordOnly) {
      // td requires the summary here and says so itself if it is missing.
      setLastAction('record')
      record.mutate(
        { summary: note, ...attribution() },
        { onSuccess: done, onSettled: () => { submitting.current = false } },
      )
      return
    }
    setLastAction('transition')
    transition.mutate(
      { action: pending!, ...(note ? { reason: note } : {}), ...attribution() },
      { onSuccess: done, onSettled: () => { submitting.current = false } },
    )
  }

  return (
    /* Three siblings, not a wrapper around them: IssueDetail's control row is
       a grid, and it puts this button row and IssueActions' buttons in two
       columns of one row so all seven read as one bar. That only works if the
       reason form and the error panel are separate grid items able to claim a
       full-width row of their own — inside a wrapper they would be trapped in
       the button row's column, and td's rejection wording would render at the
       width of four buttons. The column and span classes are inert outside a
       grid, so BoardTransitionPanel, which stacks these three in a plain
       block, is unaffected.

       No margin and no rule above the buttons either. Both are the host's to
       decide, and the hosts want different things: a margin here would drop
       IssueDetail's two button groups out of alignment, while
       BoardTransitionPanel wants a separator and supplies its own. A rule
       here would also split one control bar into two. */
    <>
      <div className="col-start-1 flex flex-wrap gap-1.5">
        {available.map(action => (
          <button
            key={action}
            className={`rounded-sm border px-2.5 py-1 text-[11px] disabled:opacity-40 ${
              tone[action] ?? 'border-line text-ink'
            }`}
            disabled={busy}
            onClick={() => {
              if (takesReason[action]) {
                open(action)
                return
              }
              // Fires at once, so any form still open belongs to an action the
              // user has just walked away from — it goes with it. The claim on
              // the panel is staked after close(), which clears it.
              close()
              setLastAction('transition')
              transition.mutate({ action }, { onSuccess: () => onDone?.() })
            }}
          >
            {transitionLabels[action] ?? action}
          </button>
        ))}
      </div>

      {pending && (
        <form
          className="col-span-full mt-3"
          onSubmit={e => {
            e.preventDefault()
            submit()
          }}
        >
          {pending === 'approve' && (
            <AttributionFieldset
              idPrefix="transition"
              mode={mode}
              onMode={setMode}
              reviewedBy={reviewedBy}
              onReviewedBy={setReviewedBy}
            >
              {/* Attest without closing, so the implementer or orchestrator
                  closes later. td calls the note a summary and requires it. */}
              <label className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={recordOnly}
                  onChange={e => setRecordOnly(e.target.checked)}
                />
                <span>Record only, do not close</span>
              </label>
            </AttributionFieldset>
          )}

          <ReasonField idPrefix="transition" value={reason} onChange={setReason} />
          <div className="mt-2 flex gap-1.5">
            <button
              type="submit"
              disabled={busy || incomplete}
              className="rounded-sm border border-accent px-3 py-1 text-[11px] text-accent disabled:opacity-40"
            >
              {recordOnly ? 'Record review' : `Confirm ${pending}`}
            </button>
            <button
              type="button"
              onClick={close}
              className="rounded-sm border border-line px-3 py-1 text-[11px] text-ink-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {panelError && (
        // td phrases policy rejections and validation errors precisely. Show
        // its message unchanged; a generic "not allowed" would lose the reason.
        <div className="col-span-full mt-2">
          <ErrorPanel label="Transition rejected" message={panelError} />
        </div>
      )}
    </>
  )
}
