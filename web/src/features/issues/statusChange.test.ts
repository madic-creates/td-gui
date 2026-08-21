import { describe, expect, it } from 'vitest'
import { overrideNote, planFor } from './statusChange'

describe('planFor', () => {
  it('runs the transition td reports for the target status', () => {
    expect(planFor('in_progress', 'open', ['start', 'review', 'block', 'close']))
      .toEqual({ kind: 'transition', action: 'start' })
  })

  // Both reach closed. approve records a review and is what td offers from
  // in_review; close is the admin exit. Where td offers both, the one that
  // carries the review meaning is the one the user meant by "closed".
  it('prefers approve over close when both reach closed', () => {
    expect(planFor('closed', 'in_review', ['approve', 'close']))
      .toEqual({ kind: 'transition', action: 'approve' })
  })

  it('reads reject as the way back to open', () => {
    expect(planFor('open', 'in_review', ['approve', 'reject']))
      .toEqual({ kind: 'transition', action: 'reject' })
  })

  // td serve reports no transition from in_progress back to open — unstart is
  // a 404 there — so this is one of the three jumps that leave the proxy.
  it('falls back to the override when no reported transition reaches the target', () => {
    expect(planFor('open', 'in_progress', ['review', 'block', 'close']))
      .toEqual({ kind: 'override' })
  })

  it('has nothing to do when the target is the status the issue already has', () => {
    expect(planFor('open', 'open', ['start', 'review'])).toBeNull()
  })

  // td-gui renders no transition it was not told about, and this is the same
  // rule: without available_transitions there is nothing to decide from.
  it('has nothing to do when td did not say which transitions exist', () => {
    expect(planFor('in_progress', 'open', undefined)).toBeNull()
  })
})

// The two override paths are not the same write: td unstart records the
// revert in the session log, td update --status reaches the status and
// records nothing. The route picks the command; this is where the UI's claim
// about it is kept, so the two cannot drift apart unnoticed.
describe('overrideNote', () => {
  it('promises a record for the revert td unstart handles', () => {
    expect(overrideNote('open', 'in_progress')).toMatch(/session log/)
  })

  it('warns that every other override leaves no trace', () => {
    expect(overrideNote('in_progress', 'blocked')).toMatch(/no trace/)
    expect(overrideNote('in_progress', 'in_review')).toMatch(/no trace/)
  })
})
