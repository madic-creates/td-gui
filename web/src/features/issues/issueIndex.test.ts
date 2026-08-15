import { describe, expect, it } from 'vitest'
import { candidatesFor, childrenOf, indexById, isResolved, resolve } from './issueIndex'
import { makeIssue } from './issue.fixture'
import type { Dependency } from '../../api/types'

const dep = (over: Partial<Dependency> = {}): Dependency => ({
  dep_id: 'dep_1', issue_id: 'td-waits', depends_on_id: 'td-blocks',
  relation_type: 'depends_on', ...over,
})

describe('resolve', () => {
  // The two ends of one row are two different questions. Reading the wrong
  // one renders a panel that looks right and lists the opposite issues.
  it('reads depends_on_id for what the issue waits for', () => {
    const blocker = makeIssue({ id: 'td-blocks', title: 'The blocker' })
    const index = indexById([blocker])

    expect(resolve([dep()], index, 'depends_on_id')).toEqual([
      { id: 'td-blocks', issue: blocker },
    ])
  })

  it('reads issue_id for what waits on the issue', () => {
    const dependent = makeIssue({ id: 'td-waits', title: 'The dependent' })
    const index = indexById([dependent])

    expect(resolve([dep()], index, 'issue_id')).toEqual([
      { id: 'td-waits', issue: dependent },
    ])
  })

  // A capped list and a deleted issue are indistinguishable here, and both
  // mean the same to the reader: the title is unknown. The row survives.
  it('keeps a reference the index does not hold, with a null issue', () => {
    expect(resolve([dep()], indexById([]), 'depends_on_id')).toEqual([
      { id: 'td-blocks', issue: null },
    ])
  })

  it('resolves every row of a mixed batch independently', () => {
    const known = makeIssue({ id: 'td-known' })
    const rows = [
      dep({ dep_id: 'dep_1', depends_on_id: 'td-known' }),
      dep({ dep_id: 'dep_2', depends_on_id: 'td-missing' }),
    ]

    expect(resolve(rows, indexById([known]), 'depends_on_id')).toEqual([
      { id: 'td-known', issue: known },
      { id: 'td-missing', issue: null },
    ])
  })

  it('returns nothing for no rows', () => {
    expect(resolve([], indexById([makeIssue()]), 'depends_on_id')).toEqual([])
  })
})

describe('childrenOf', () => {
  it('selects the issues whose parent is the given id', () => {
    const child = makeIssue({ id: 'td-child', parent_id: 'td-epic' })
    const other = makeIssue({ id: 'td-other', parent_id: 'td-elsewhere' })
    const orphan = makeIssue({ id: 'td-orphan', parent_id: null })

    expect(childrenOf([child, other, orphan], 'td-epic')).toEqual([child])
  })

  it('returns nothing when no issue names that parent', () => {
    expect(childrenOf([makeIssue({ parent_id: null })], 'td-epic')).toEqual([])
  })
})

describe('isResolved', () => {
  it('counts a closed blocker as resolved', () => {
    expect(isResolved({ id: 'td-a', issue: makeIssue({ status: 'closed' }) })).toBe(true)
  })

  it('counts every other status as still blocking', () => {
    expect(isResolved({ id: 'td-a', issue: makeIssue({ status: 'in_review' }) })).toBe(false)
  })

  // Unknown is not the same as done — an unresolved row stays in the active
  // group rather than being quietly filed away as finished.
  it('counts an unresolved reference as still blocking', () => {
    expect(isResolved({ id: 'td-a', issue: null })).toBe(false)
  })
})

describe('candidatesFor', () => {
  it('drops every excluded id', () => {
    const self = makeIssue({ id: 'td-self' })
    const linked = makeIssue({ id: 'td-linked' })
    const free = makeIssue({ id: 'td-free' })

    expect(candidatesFor([self, linked, free], ['td-self', 'td-linked']))
      .toEqual([free])
  })

  // A dependency on a closed issue is legitimate — the panel has a "Resolved"
  // group for exactly that — so closed issues stay offerable, just last.
  it('sorts closed issues after the ones still open', () => {
    const done = makeIssue({ id: 'td-done', status: 'closed' })
    const doing = makeIssue({ id: 'td-doing', status: 'in_progress' })

    expect(candidatesFor([done, doing], [])).toEqual([doing, done])
  })

  it('keeps the incoming order within each group', () => {
    const first = makeIssue({ id: 'td-1' })
    const second = makeIssue({ id: 'td-2' })
    const oldest = makeIssue({ id: 'td-3', status: 'closed' })
    const newest = makeIssue({ id: 'td-4', status: 'closed' })

    expect(candidatesFor([first, oldest, second, newest], []))
      .toEqual([first, second, oldest, newest])
  })

  it('returns nothing for an empty list', () => {
    expect(candidatesFor([], ['td-self'])).toEqual([])
  })
})
