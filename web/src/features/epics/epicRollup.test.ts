import { describe, expect, it } from 'vitest'
import { childIndex, rollup } from './epicRollup'
import { makeIssue } from '../issues/issue.fixture'
import type { Issue } from '../../api/types'

const rollupOf = (issues: Issue[], rootId: string) => rollup(childIndex(issues), rootId)

describe('childIndex', () => {
  it('groups the issues under the parent each one names', () => {
    const first = makeIssue({ id: 'td-c1', parent_id: 'td-epic' })
    const second = makeIssue({ id: 'td-c2', parent_id: 'td-epic' })
    const elsewhere = makeIssue({ id: 'td-c3', parent_id: 'td-other' })

    const index = childIndex([first, second, elsewhere, makeIssue({ id: 'td-top' })])

    expect(index.get('td-epic')).toEqual([first, second])
    expect(index.get('td-other')).toEqual([elsewhere])
    expect(index.has('td-top')).toBe(false)
  })
})

describe('rollup', () => {
  it('counts a grandchild as well as a child', () => {
    const issues = [
      makeIssue({ id: 'td-child', parent_id: 'td-epic' }),
      makeIssue({ id: 'td-grandchild', parent_id: 'td-child', status: 'closed' }),
      makeIssue({ id: 'td-greatgrandchild', parent_id: 'td-grandchild' }),
    ]

    expect(rollupOf(issues, 'td-epic')).toMatchObject({ total: 3, done: 1 })
  })

  it('counts nothing outside the subtree', () => {
    const issues = [
      makeIssue({ id: 'td-mine', parent_id: 'td-epic' }),
      makeIssue({ id: 'td-theirs', parent_id: 'td-elsewhere' }),
      makeIssue({ id: 'td-loose', parent_id: null }),
    ]

    expect(rollupOf(issues, 'td-epic').total).toBe(1)
  })

  // `closed` is td's own answer to whether a task is finished. Nothing else is
  // read as done — an epic whose last task sits in review is not complete.
  it('counts only closed descendants as done', () => {
    const issues = [
      makeIssue({ id: 'td-a', parent_id: 'td-epic', status: 'closed' }),
      makeIssue({ id: 'td-b', parent_id: 'td-epic', status: 'in_review' }),
      makeIssue({ id: 'td-c', parent_id: 'td-epic', status: 'blocked' }),
    ]

    expect(rollupOf(issues, 'td-epic')).toMatchObject({ total: 3, done: 1 })
  })

  it('buckets the descendants by status, in the list view order', () => {
    const issues = [
      makeIssue({ id: 'td-a', parent_id: 'td-epic', status: 'closed' }),
      makeIssue({ id: 'td-b', parent_id: 'td-epic', status: 'open' }),
      makeIssue({ id: 'td-c', parent_id: 'td-epic', status: 'in_progress' }),
      makeIssue({ id: 'td-d', parent_id: 'td-epic', status: 'open' }),
    ]

    expect(rollupOf(issues, 'td-epic').buckets).toEqual([
      { status: 'in_progress', count: 1 },
      { status: 'open', count: 2 },
      { status: 'closed', count: 1 },
    ])
  })

  // A status td grows later must still be counted and drawn. Dropping it would
  // make the segments add up to less than the total the same bar reports.
  it('keeps a status it does not recognise, after the ones it does', () => {
    const issues = [
      makeIssue({ id: 'td-a', parent_id: 'td-epic', status: 'open' }),
      makeIssue({ id: 'td-b', parent_id: 'td-epic', status: 'deferred' as never }),
    ]

    expect(rollupOf(issues, 'td-epic').buckets).toEqual([
      { status: 'open', count: 1 },
      { status: 'deferred', count: 1 },
    ])
  })

  // td's API accepts a parent_id ring even though the picker cannot build one,
  // so the walk has to survive reaching an issue it has already counted.
  it('terminates on a parent_id cycle and counts each issue once', () => {
    const issues = [
      makeIssue({ id: 'td-a', parent_id: 'td-c' }),
      makeIssue({ id: 'td-b', parent_id: 'td-a' }),
      makeIssue({ id: 'td-c', parent_id: 'td-b' }),
    ]

    expect(rollupOf(issues, 'td-a')).toMatchObject({ total: 2, done: 0 })
  })

  // The majority case on the measured project: 24 of 30 epics have no tasks at
  // all. It is a state of its own, not zero percent.
  it('reports an epic with no children as 0/0', () => {
    expect(rollupOf([makeIssue({ id: 'td-epic' })], 'td-epic')).toEqual({
      total: 0, done: 0, buckets: [],
    })
  })

  // A capped index holds children whose parent it does not: the id came off
  // the child's own parent_id, and asking about it must answer rather than
  // throw. 0/0 is the honest answer — this walk knows of no descendants.
  it('reports 0/0 for an id the index does not hold', () => {
    const orphan = makeIssue({ id: 'td-orphan', parent_id: 'td-missing' })

    expect(rollupOf([orphan], 'td-absent')).toEqual({ total: 0, done: 0, buckets: [] })
  })

  // The other half of the same case: the orphan is still reachable through the
  // parent it names, even though nothing in the index describes that parent.
  it('rolls up under a parent the index does not hold', () => {
    const orphan = makeIssue({ id: 'td-orphan', parent_id: 'td-missing', status: 'closed' })

    expect(rollupOf([orphan], 'td-missing')).toMatchObject({ total: 1, done: 1 })
  })
})
