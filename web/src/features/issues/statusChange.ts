import type { IssueStatus, Transition } from '../../api/types'

/**
 * Which status each of td's transitions results in.
 *
 * The only knowledge of td's workflow held in the frontend, and deliberately
 * the smallest kind: it reads td's answer, it does not predict it. Which
 * transitions exist for an issue stays `available_transitions`, and which
 * jumps td will make at all stays td's to refuse, in its own words.
 */
const resultOf: Record<Transition, IssueStatus> = {
  start: 'in_progress',
  review: 'in_review',
  block: 'blocked',
  approve: 'closed',
  close: 'closed',
  reject: 'open',
  unblock: 'open',
  reopen: 'open',
}

/**
 * Which transition to prefer when several reach one status. approve and close
 * both close an issue; approve records the review, so it is what the user
 * meant by picking closed on an issue awaiting one. reject likewise carries
 * more than unblock or reopen do.
 */
const preference: Transition[] = [
  'approve', 'close', 'start', 'review', 'block', 'reject', 'unblock', 'reopen',
]

export type StatusPlan =
  /** td reports a transition that lands on the target: use td's own endpoint. */
  | { kind: 'transition'; action: Transition }
  /** td serve has no route for this move, so it leaves the proxy. */
  | { kind: 'override' }

/**
 * How to get from `current` to `target`, or null when there is nothing to do:
 * the issue is already there, or td did not say which transitions it has and
 * this is not the place to guess.
 */
export function planFor(
  target: IssueStatus,
  current: IssueStatus,
  available: Transition[] | undefined,
): StatusPlan | null {
  if (!available || target === current) return null

  const action = preference.find(t => available.includes(t) && resultOf[t] === target)
  return action ? { kind: 'transition', action } : { kind: 'override' }
}

/**
 * What an override costs, in the words the confirm shows.
 *
 * The route reaches for `td unstart` when the target is open, because it is
 * the only command that records the move — td writes "Reverted to open" to
 * the session log, where `td update --status` reaches the same status and
 * writes nothing. unstart reverts from in_progress alone, so that pairing is
 * the one case with a record, and it is stated here rather than in the markup
 * so the claim sits next to the plan it describes.
 */
export function overrideNote(target: IssueStatus, current: IssueStatus): string {
  if (target === 'open' && current === 'in_progress') {
    return 'td records this in the session log as a revert to open.'
  }
  return 'td serve has no transition for this move, so td-gui runs td itself. '
    + 'It leaves no trace beyond the timestamp: no log entry, no review.'
}
