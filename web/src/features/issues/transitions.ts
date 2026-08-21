import type { Attribution } from '../../api/mutations'
import type { Transition } from '../../api/types'

/** What each of td's transitions is called in the UI. */
export const transitionLabels: Record<Transition, string> = {
  start: 'Start',
  review: 'Request review',
  approve: 'Approve',
  reject: 'Reject',
  block: 'Block',
  unblock: 'Unblock',
  close: 'Close',
  reopen: 'Reopen',
}

/**
 * Transitions that confirm through a form. For reject, block and close td
 * appends the note as a progress log entry, so dropping it would make the GUI
 * strictly worse than `td reject --reason`; approve additionally carries the
 * review attribution td's trusted mode asks for.
 */
export const takesReason: Partial<Record<Transition, true>> = {
  reject: true,
  block: true,
  close: true,
  approve: true,
}

/**
 * How an approval is attributed. `attributed` and `self` map to td's
 * reviewed_by and self_review, which it rejects together with a 400 — a radio
 * group keeps that state unreachable.
 */
export type ApproveMode = 'independent' | 'attributed' | 'self'

export const approveModes: [ApproveMode, string][] = [
  ['independent', 'I reviewed this independently'],
  ['attributed', 'Reviewed by someone else'],
  ['self', 'I reviewed my own work'],
]

/** Only ever sets one of reviewed_by / self_review — never both. */
export function attributionOf(mode: ApproveMode, reviewedBy: string): Omit<Attribution, 'reason'> {
  if (mode === 'attributed') return { reviewed_by: reviewedBy.trim() }
  if (mode === 'self') return { self_review: true }
  return {}
}

/**
 * td only rejects a whitespace-only reviewed_by (trims to empty but arrives
 * non-empty); a genuinely empty string passes its validation and is recorded
 * as an unattributed review — silently not what "Reviewed by someone else"
 * promised. Blocked here rather than let it round-trip into a mislabeled
 * approval.
 */
export function attributionIncomplete(mode: ApproveMode, reviewedBy: string): boolean {
  return mode === 'attributed' && !reviewedBy.trim()
}
