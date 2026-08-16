import { useRef, useState } from 'react'
import { unboundMessage } from '../../api/client'
import { useRecordReview, useTransition, type Attribution } from '../../api/mutations'
import ErrorPanel from '../../components/ErrorPanel'
import type { Transition } from '../../api/types'

const labels: Record<Transition, string> = {
  start: 'Start',
  review: 'Request review',
  approve: 'Approve',
  reject: 'Reject',
  block: 'Block',
  unblock: 'Unblock',
  close: 'Close',
  reopen: 'Reopen',
}

const tone: Partial<Record<Transition, string>> = {
  approve: 'border-success/40 text-success',
  reject: 'border-danger/40 text-danger',
  block: 'border-danger/40 text-danger',
}

/**
 * Transitions that confirm through a form. For reject, block and close td
 * appends the note as a progress log entry, so dropping it would make the GUI
 * strictly worse than `td reject --reason`; approve additionally carries the
 * review attribution td's trusted mode asks for.
 */
const takesReason: Partial<Record<Transition, true>> = {
  reject: true,
  block: true,
  close: true,
  approve: true,
}

/**
 * How the approval is attributed. `attributed` and `self` map to td's
 * reviewed_by and self_review, which it rejects together with a 400 — a radio
 * group keeps that state unreachable.
 */
type ApproveMode = 'independent' | 'attributed' | 'self'

const approveModes: [ApproveMode, string][] = [
  ['independent', 'I reviewed this independently'],
  ['attributed', 'Reviewed by someone else'],
  ['self', 'I reviewed my own work'],
]

interface Props {
  issueId: string
  /** Absent means td did not tell us — render nothing rather than guess. */
  available?: Transition[]
}

export default function TransitionBar({ issueId, available }: Props) {
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

  /** Only ever sets one of reviewed_by / self_review — never both. */
  const attribution = (): Omit<Attribution, 'reason'> => {
    if (pending !== 'approve') return {}
    if (mode === 'attributed') return { reviewed_by: reviewedBy.trim() }
    if (mode === 'self') return { self_review: true }
    return {}
  }

  const submit = () => {
    if (submitting.current) return
    submitting.current = true
    const note = reason.trim()
    if (recordOnly) {
      // td requires the summary here and says so itself if it is missing.
      setLastAction('record')
      record.mutate(
        { summary: note, ...attribution() },
        { onSuccess: close, onSettled: () => { submitting.current = false } },
      )
      return
    }
    setLastAction('transition')
    transition.mutate(
      { action: pending!, ...(note ? { reason: note } : {}), ...attribution() },
      { onSuccess: close, onSettled: () => { submitting.current = false } },
    )
  }

  return (
    <div className="mt-4 border-t border-line-subtle pt-4">
      <div className="flex flex-wrap gap-1.5">
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
              transition.mutate({ action })
            }}
          >
            {labels[action] ?? action}
          </button>
        ))}
      </div>

      {pending && (
        <form
          className="mt-3"
          onSubmit={e => {
            e.preventDefault()
            submit()
          }}
        >
          {pending === 'approve' && (
            <fieldset className="mb-3">
              <legend className="mb-1.5 text-[11px] uppercase tracking-widest text-ink-muted">
                Attribution
              </legend>
              {approveModes.map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 py-0.5">
                  <input
                    type="radio"
                    name="approve-mode"
                    value={value}
                    checked={mode === value}
                    onChange={() => setMode(value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
              {mode === 'attributed' && (
                <div className="mt-2">
                  <label
                    htmlFor="reviewed-by"
                    className="mb-1.5 block text-[11px] uppercase tracking-widest text-ink-muted"
                  >
                    Reviewer
                  </label>
                  {/* A single-line input rules out the newlines td rejects.
                      The length cap is an affordance only — td validates. */}
                  <input
                    id="reviewed-by"
                    type="text"
                    maxLength={120}
                    value={reviewedBy}
                    onChange={e => setReviewedBy(e.target.value)}
                    className="w-full rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink"
                  />
                </div>
              )}

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
            </fieldset>
          )}

          <label
            htmlFor="transition-reason"
            className="mb-1.5 block text-[11px] uppercase tracking-widest text-ink-muted"
          >
            Reason
          </label>
          <textarea
            id="transition-reason"
            rows={2}
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="w-full rounded-sm border border-line bg-surface-inset px-2.5 py-2 text-ink"
          />
          <div className="mt-2 flex gap-1.5">
            <button
              type="submit"
              disabled={busy}
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
        <div className="mt-2">
          <ErrorPanel label="Transition rejected" message={panelError} />
        </div>
      )}
    </div>
  )
}
