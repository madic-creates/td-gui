import { describe, expect, it } from 'vitest'
import { byRecentActivity, labelFor, sessionLabel } from './sessions'
import { makeSession } from './activity.fixture'

describe('sessionLabel', () => {
  it('prefers the name td recorded', () => {
    expect(sessionLabel(makeSession({ name: 'planner', agent_type: 'claude-code_1' }))).toBe('planner')
  })

  it('falls back to the agent type', () => {
    expect(sessionLabel(makeSession({ name: '', agent_type: 'claude-code_1' }))).toBe('claude-code_1')
  })

  it('falls back to the short session id', () => {
    expect(sessionLabel(makeSession({ id: 'ses_d87edf', name: '', agent_type: '' }))).toBe('d87e')
  })
})

describe('labelFor', () => {
  const sessions = [makeSession({ id: 'ses_111111', name: 'planner' })]

  it('labels a session it can find', () => {
    expect(labelFor(sessions, 'ses_111111')).toBe('planner')
  })

  it('shows the short id for a session it cannot find', () => {
    expect(labelFor(sessions, 'ses_d87edf')).toBe('d87e')
    expect(labelFor(undefined, 'ses_d87edf')).toBe('d87e')
  })

  it('says so when the event carries no session at all', () => {
    expect(labelFor(sessions, '')).toBe('unknown session')
  })
})

describe('byRecentActivity', () => {
  const order = (...sessions: ReturnType<typeof makeSession>[]) =>
    [...sessions].sort(byRecentActivity).map(s => s.id)

  it('puts the most recently active session first, comparing instants', () => {
    // 12:30+02:00 is 10:30Z, earlier than 11:00Z, although its string sorts later.
    expect(order(
      makeSession({ id: 'ses_a', last_activity: '2026-10-15T12:30:00+02:00' }),
      makeSession({ id: 'ses_b', last_activity: '2026-10-15T11:00:00Z' }),
    )).toEqual(['ses_b', 'ses_a'])
  })

  it('sorts an unparseable timestamp last', () => {
    expect(order(
      makeSession({ id: 'ses_a', last_activity: 'garbage' }),
      makeSession({ id: 'ses_b', last_activity: '2026-01-01T00:00:00Z' }),
    )).toEqual(['ses_b', 'ses_a'])
  })

  it('breaks ties by id so a refetch never reshuffles equal rows', () => {
    const at = '2026-10-15T12:00:00Z'
    expect(order(
      makeSession({ id: 'ses_c', last_activity: at }),
      makeSession({ id: 'ses_a', last_activity: at }),
      makeSession({ id: 'ses_b', last_activity: 'garbage' }),
      makeSession({ id: 'ses_0', last_activity: 'garbage' }),
    )).toEqual(['ses_a', 'ses_c', 'ses_0', 'ses_b'])
  })
})
