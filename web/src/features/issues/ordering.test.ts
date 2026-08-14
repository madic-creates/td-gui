import { describe, expect, it } from 'vitest'
import { DEFAULT_SORT, sortIssues } from './ordering'
import { makeIssue } from './issue.fixture'

const ids = (issues: { id: string }[]) => issues.map(i => i.id)

describe('sortIssues', () => {
  it('defaults to priority ascending, which is the order td already returns', () => {
    expect(DEFAULT_SORT).toEqual({ key: 'priority', direction: 'asc' })
  })

  it('orders by priority rank, not alphabetically', () => {
    const issues = [
      makeIssue({ id: 'td-c', priority: 'P2' }),
      makeIssue({ id: 'td-a', priority: 'P0' }),
      makeIssue({ id: 'td-b', priority: 'P1' }),
    ]
    expect(ids(sortIssues(issues, { key: 'priority', direction: 'asc' })))
      .toEqual(['td-a', 'td-b', 'td-c'])
    expect(ids(sortIssues(issues, { key: 'priority', direction: 'desc' })))
      .toEqual(['td-c', 'td-b', 'td-a'])
  })

  it('puts an unrecognised priority last in both directions', () => {
    const issues = [
      makeIssue({ id: 'td-weird', priority: 'P9' as never }),
      makeIssue({ id: 'td-a', priority: 'P0' }),
      makeIssue({ id: 'td-b', priority: 'P3' }),
    ]
    expect(ids(sortIssues(issues, { key: 'priority', direction: 'asc' })))
      .toEqual(['td-a', 'td-b', 'td-weird'])
    expect(ids(sortIssues(issues, { key: 'priority', direction: 'desc' })))
      .toEqual(['td-b', 'td-a', 'td-weird'])
  })

  it('orders by parsed timestamp, so a daylight-saving offset change cannot fool it', () => {
    const issues = [
      // Later instant, but the smaller string: "2026-01-10T01:30+01:00" is
      // 00:30 UTC, while "2025-07-09T02:00+02:00" is 00:00 UTC on an earlier
      // date. A string comparison would order these the other way round.
      makeIssue({ id: 'td-jan', updated_at: '2026-01-10T01:30:00+01:00' }),
      makeIssue({ id: 'td-jul', updated_at: '2025-07-09T02:00:00+02:00' }),
    ]
    expect(ids(sortIssues(issues, { key: 'updated', direction: 'asc' })))
      .toEqual(['td-jul', 'td-jan'])
  })

  it('puts an unparseable timestamp last in both directions', () => {
    const issues = [
      makeIssue({ id: 'td-broken', updated_at: 'not a date' }),
      makeIssue({ id: 'td-old', updated_at: '2026-01-01T00:00:00+02:00' }),
      makeIssue({ id: 'td-new', updated_at: '2026-08-01T00:00:00+02:00' }),
    ]
    expect(ids(sortIssues(issues, { key: 'updated', direction: 'asc' })))
      .toEqual(['td-old', 'td-new', 'td-broken'])
    expect(ids(sortIssues(issues, { key: 'updated', direction: 'desc' })))
      .toEqual(['td-new', 'td-old', 'td-broken'])
  })

  it('orders by id and by title', () => {
    const issues = [
      makeIssue({ id: 'td-c', title: 'Beta' }),
      makeIssue({ id: 'td-a', title: 'Gamma' }),
      makeIssue({ id: 'td-b', title: 'Alpha' }),
    ]
    expect(ids(sortIssues(issues, { key: 'id', direction: 'asc' })))
      .toEqual(['td-a', 'td-b', 'td-c'])
    expect(ids(sortIssues(issues, { key: 'title', direction: 'asc' })))
      .toEqual(['td-b', 'td-c', 'td-a'])
  })

  it('breaks ties on id, so a refetch cannot reshuffle equal rows', () => {
    const issues = [
      makeIssue({ id: 'td-c', priority: 'P1' }),
      makeIssue({ id: 'td-a', priority: 'P1' }),
      makeIssue({ id: 'td-b', priority: 'P1' }),
    ]
    // The tie-break is NOT reversed by direction: it exists to make the order
    // deterministic, not to be part of the user's chosen ordering.
    expect(ids(sortIssues(issues, { key: 'priority', direction: 'asc' })))
      .toEqual(['td-a', 'td-b', 'td-c'])
    expect(ids(sortIssues(issues, { key: 'priority', direction: 'desc' })))
      .toEqual(['td-a', 'td-b', 'td-c'])
  })

  it('does not mutate its input', () => {
    const issues = [
      makeIssue({ id: 'td-b', priority: 'P3' }),
      makeIssue({ id: 'td-a', priority: 'P0' }),
    ]
    sortIssues(issues, { key: 'priority', direction: 'asc' })
    expect(ids(issues)).toEqual(['td-b', 'td-a'])
  })
})
