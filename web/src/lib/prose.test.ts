import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PROSE_STORAGE_KEY,
  getMode,
  otherMode,
  readStoredMode,
  setMode,
  storeMode,
  subscribe,
} from './prose'

beforeEach(() => {
  setMode('markdown')
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('otherMode', () => {
  it('flips between the two modes', () => {
    expect(otherMode('markdown')).toBe('raw')
    expect(otherMode('raw')).toBe('markdown')
  })
})

describe('readStoredMode', () => {
  it('defaults to markdown when nothing was ever stored', () => {
    expect(readStoredMode()).toBe('markdown')
  })

  it('returns a previously stored mode', () => {
    storeMode('raw')
    expect(localStorage.getItem(PROSE_STORAGE_KEY)).toBe('raw')
    expect(readStoredMode()).toBe('raw')
  })

  it('falls back to markdown on a value it does not recognise', () => {
    localStorage.setItem(PROSE_STORAGE_KEY, 'plaintext')
    expect(readStoredMode()).toBe('markdown')
  })

  it('falls back to markdown when storage is unavailable', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    expect(readStoredMode()).toBe('markdown')
  })
})

describe('storeMode', () => {
  it('does not throw when storage refuses the write', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    expect(() => storeMode('raw')).not.toThrow()
  })
})

describe('the mode store', () => {
  it('reports the mode it was last set to', () => {
    setMode('raw')
    expect(getMode()).toBe('raw')
  })

  it('persists what it is set to, so a reload keeps the choice', () => {
    setMode('raw')
    expect(readStoredMode()).toBe('raw')
  })

  it('notifies subscribers on a change', () => {
    const seen: string[] = []
    subscribe(() => seen.push(getMode()))

    setMode('raw')
    setMode('markdown')

    expect(seen).toEqual(['raw', 'markdown'])
  })

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)

    unsubscribe()
    setMode('raw')

    expect(listener).not.toHaveBeenCalled()
  })

  /* The store is read by every mounted Markdown, so its starting value has to
     be the stored one rather than the default. A fresh module instance is the
     only way to observe module initialisation from a test that has already
     imported it. */
  it('starts on the stored mode rather than the default', async () => {
    localStorage.setItem(PROSE_STORAGE_KEY, 'raw')
    vi.resetModules()

    const fresh = await import('./prose')

    expect(fresh.getMode()).toBe('raw')
  })
})
