import { describe, expect, it } from 'vitest'
import { DEFAULT_SORT, groupByStatus, sortIssues, STATUS_ORDER } from './ordering'
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
    // Same wall-clock date, different offsets — the hour either side of a DST
    // change. As strings, "02:00:00+01:00" sorts BEFORE "02:30:00+02:00"; as
    // instants it is the other way round, 01:00Z after 00:30Z. A string
    // comparison therefore fails this test, which is the whole point of it.
    const issues = [
      makeIssue({ id: 'td-later', updated_at: '2026-03-29T02:00:00+01:00' }),
      makeIssue({ id: 'td-earlier', updated_at: '2026-03-29T02:30:00+02:00' }),
    ]
    expect(ids(sortIssues(issues, { key: 'updated', direction: 'asc' })))
      .toEqual(['td-earlier', 'td-later'])
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

describe('groupByStatus', () => {
  it('returns groups in attention order, not input order', () => {
    const groups = groupByStatus([
      makeIssue({ id: 'td-closed', status: 'closed' }),
      makeIssue({ id: 'td-open', status: 'open' }),
      makeIssue({ id: 'td-prog', status: 'in_progress' }),
    ], DEFAULT_SORT)
    expect(groups.map(g => g.status)).toEqual(['in_progress', 'open', 'closed'])
  })

  it('omits statuses with no issues', () => {
    const groups = groupByStatus([makeIssue({ status: 'open' })], DEFAULT_SORT)
    expect(groups.map(g => g.status)).toEqual(['open'])
    expect(STATUS_ORDER).toContain('blocked')
  })

  it('keeps an unknown status as its own trailing group instead of dropping it', () => {
    const groups = groupByStatus([
      makeIssue({ id: 'td-new', status: 'archived' as never }),
      makeIssue({ id: 'td-open', status: 'open' }),
    ], DEFAULT_SORT)
    expect(groups.map(g => g.status)).toEqual(['open', 'archived'])
    expect(groups[1].issues.map(i => i.id)).toEqual(['td-new'])
  })

  it('orders several unknown statuses by first appearance', () => {
    const groups = groupByStatus([
      makeIssue({ id: 'td-2', status: 'zeta' as never }),
      makeIssue({ id: 'td-1', status: 'alpha' as never }),
    ], DEFAULT_SORT)
    expect(groups.map(g => g.status)).toEqual(['zeta', 'alpha'])
  })

  it('sorts within each group and never moves an issue between groups', () => {
    // The ids deliberately disagree with the priority order: by id the open
    // group reads td-aaa, td-zzz; by priority it reads td-zzz, td-aaa. With
    // ids that agreed, an implementation ignoring the sort key entirely would
    // pass this test.
    const issues = [
      makeIssue({ id: 'td-aaa', status: 'open', priority: 'P3' }),
      makeIssue({ id: 'td-mmm', status: 'in_progress', priority: 'P2' }),
      makeIssue({ id: 'td-zzz', status: 'open', priority: 'P0' }),
    ]

    const asc = groupByStatus(issues, { key: 'priority', direction: 'asc' })
    expect(asc.map(g => g.status)).toEqual(['in_progress', 'open'])
    // td-zzz is P0, the highest priority in the whole list, and still sits
    // below the in_progress group: the grouping outranks the sort.
    expect(asc[0].issues.map(i => i.id)).toEqual(['td-mmm'])
    expect(asc[1].issues.map(i => i.id)).toEqual(['td-zzz', 'td-aaa'])

    // Reversing the direction reorders inside the group but must not reorder
    // the groups themselves.
    const desc = groupByStatus(issues, { key: 'priority', direction: 'desc' })
    expect(desc.map(g => g.status)).toEqual(['in_progress', 'open'])
    expect(desc[1].issues.map(i => i.id)).toEqual(['td-aaa', 'td-zzz'])
  })

  it('does not mutate the array it was given', () => {
    const issues = [
      makeIssue({ id: 'td-b', status: 'closed' }),
      makeIssue({ id: 'td-a', status: 'open' }),
    ]
    groupByStatus(issues, DEFAULT_SORT)
    expect(issues.map(i => i.id)).toEqual(['td-b', 'td-a'])
  })

  it('returns no groups for no issues', () => {
    expect(groupByStatus([], DEFAULT_SORT)).toEqual([])
  })
})
