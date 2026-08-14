import { describe, expect, it } from 'vitest'
import { relativeTime, shortSession } from './format'

const now = new Date('2026-08-14T12:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('relativeTime', () => {
  it('calls anything under a minute "just now"', () => {
    expect(relativeTime(ago(0), now)).toBe('just now')
    expect(relativeTime(ago(59 * SECOND), now)).toBe('just now')
  })

  it('switches to minutes at 60 seconds', () => {
    expect(relativeTime(ago(MINUTE), now)).toBe('1m ago')
    expect(relativeTime(ago(59 * MINUTE), now)).toBe('59m ago')
  })

  it('switches to hours at 60 minutes', () => {
    expect(relativeTime(ago(HOUR), now)).toBe('1h ago')
    expect(relativeTime(ago(23 * HOUR), now)).toBe('23h ago')
  })

  it('switches to days at 24 hours', () => {
    expect(relativeTime(ago(DAY), now)).toBe('1d ago')
    expect(relativeTime(ago(6 * DAY), now)).toBe('6d ago')
  })

  it('falls back to an absolute date from seven days out', () => {
    expect(relativeTime(ago(7 * DAY), now)).toBe('2026-08-07')
  })

  it('returns an empty string for an unparseable timestamp', () => {
    expect(relativeTime('not a date', now)).toBe('')
    expect(relativeTime('', now)).toBe('')
  })

  it('treats a future timestamp as "just now" rather than negative', () => {
    expect(relativeTime(new Date(now.getTime() + HOUR).toISOString(), now)).toBe('just now')
  })
})

describe('shortSession', () => {
  it('strips the ses_ prefix before shortening', () => {
    expect(shortSession('ses_d87edf')).toBe('d87e')
  })

  it('shortens an id that has no prefix', () => {
    expect(shortSession('4f2a91bc')).toBe('4f2a')
  })

  it('returns short input unchanged', () => {
    expect(shortSession('ab')).toBe('ab')
    expect(shortSession('')).toBe('')
  })
})
