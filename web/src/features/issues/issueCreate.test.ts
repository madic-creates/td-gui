import { describe, expect, it } from 'vitest'
import { blankDraft, createBodyFrom } from './issueCreate'

const title = 'A sufficiently long issue title'

describe('createBodyFrom', () => {
  // The quick path: title, submit. Everything the user did not fill has to be
  // absent rather than empty, so td applies its own defaults instead of
  // storing our blanks.
  it('sends only title, type and priority for an untouched draft', () => {
    expect(createBodyFrom({ ...blankDraft(), title }))
      .toEqual({ title, type: 'task', priority: 'P2' })
  })

  it('carries every field the endpoint honours', () => {
    expect(createBodyFrom({
      title,
      description: 'a description',
      acceptance: 'it works',
      type: 'feature',
      priority: 'P1',
      points: 5,
      sprint: 'sprint-1',
      labels: ['alpha', 'beta'],
      parent_id: 'td-a1b2c3',
      due_date: '2026-09-01',
      defer_until: '2026-08-20',
      minor: true,
    })).toEqual({
      title,
      description: 'a description',
      acceptance: 'it works',
      type: 'feature',
      priority: 'P1',
      points: 5,
      sprint: 'sprint-1',
      labels: ['alpha', 'beta'],
      parent_id: 'td-a1b2c3',
      due_date: '2026-09-01',
      defer_until: '2026-08-20',
      minor: true,
    })
  })

  // An unparseable entry reaches the draft as NaN, which would serialise to
  // null — the same reason diffIssue drops it rather than sending it.
  it('omits points that are not a finite number', () => {
    expect(createBodyFrom({ ...blankDraft(), title, points: NaN }))
      .not.toHaveProperty('points')
  })

  // 0 is a value the user typed, not an empty field, so it goes out.
  it('sends points of 0', () => {
    expect(createBodyFrom({ ...blankDraft(), title, points: 0 }).points).toBe(0)
  })

  it('omits minor when it is not checked', () => {
    expect(createBodyFrom({ ...blankDraft(), title })).not.toHaveProperty('minor')
  })

  it('omits an empty label list', () => {
    expect(createBodyFrom({ ...blankDraft(), title, labels: [] }))
      .not.toHaveProperty('labels')
  })
})

describe('blankDraft', () => {
  it('starts on td-gui\'s visible defaults', () => {
    expect(blankDraft()).toEqual({
      title: '', description: '', acceptance: '', type: 'task', priority: 'P2',
      points: null, labels: [], parent_id: '', sprint: '', minor: false,
      defer_until: '', due_date: '',
    })
  })
})
