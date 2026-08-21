import type { IssueStatus, Transition } from '../../api/types'
import { fieldClass, legendClass } from './IssueFields'
import { overrideNote, type StatusPlan } from './statusChange'
import { AttributionFieldset, ReasonField } from './TransitionInputs'
import { takesReason, transitionLabels, type ApproveMode } from './transitions'

const statuses: IssueStatus[] = ['open', 'in_progress', 'in_review', 'blocked', 'closed']

export interface StatusFieldState {
  target: IssueStatus
  setTarget: (status: IssueStatus) => void
  reason: string
  setReason: (reason: string) => void
  mode: ApproveMode
  setMode: (mode: ApproveMode) => void
  reviewedBy: string
  setReviewedBy: (name: string) => void
  acknowledged: boolean
  setAcknowledged: (value: boolean) => void
}

interface Props extends StatusFieldState {
  /** The status td currently has the issue in. */
  current: IssueStatus
  /** Absent means td did not tell us, and the select stays disabled. */
  available?: Transition[]
  /** What Save will do, from planFor. null when there is nothing to do. */
  plan: StatusPlan | null
}

/**
 * The status control in the edit form.
 *
 * Every status is offered, including the five combinations td refuses: the
 * frontend keeps no table of td's rules, so a refusal comes back from td in
 * td's own words rather than being predicted here. What it does decide is
 * which of the two backends the save will use, and it says so before the save
 * rather than after — a "closed" on an issue awaiting review means td's
 * approve, and a jump td serve has no transition for leaves the proxy.
 */
export default function StatusField({
  current, available, plan, target, setTarget,
  reason, setReason, mode, setMode, reviewedBy, setReviewedBy,
  acknowledged, setAcknowledged,
}: Props) {
  const action = plan?.kind === 'transition' ? plan.action : null

  return (
    <div>
      <label htmlFor="edit-status" className={legendClass}>Status</label>
      <select
        id="edit-status"
        value={target}
        disabled={!available}
        onChange={e => setTarget(e.target.value as IssueStatus)}
        className={`${fieldClass} disabled:opacity-40`}
      >
        {statuses.map(s => <option key={s} value={s}>{s}</option>)}
      </select>

      {plan && (
        <div className="mt-3 rounded-sm border border-line-subtle p-3">
          {action ? (
            // Naming the transition is not decoration: picking open on an
            // issue awaiting review runs td's reject, which records a
            // rejection against it.
            <p className="text-[11px] text-ink-muted">
              Save runs td&apos;s <span className="text-ink">{transitionLabels[action]}</span>.
            </p>
          ) : (
            <>
              <p className="text-[11px] text-ink-muted">{overrideNote(target, current)}</p>
              <label className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={e => setAcknowledged(e.target.checked)}
                />
                <span>Change it anyway</span>
              </label>
            </>
          )}

          {action === 'approve' && (
            <div className="mt-3">
              <AttributionFieldset
                idPrefix="edit-status"
                mode={mode}
                onMode={setMode}
                reviewedBy={reviewedBy}
                onReviewedBy={setReviewedBy}
              />
            </div>
          )}

          {action && takesReason[action] && (
            <div className="mt-3">
              <ReasonField idPrefix="edit-status" value={reason} onChange={setReason} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
