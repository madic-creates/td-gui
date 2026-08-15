import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// The shipped file itself, read through Vite so the path is resolved relative
// to this module rather than to whatever directory the runner started in.
import indexHtml from '../../index.html?raw'
import {
  THEME_STORAGE_KEY,
  applyTheme,
  nextPreference,
  readStoredPreference,
  resolveTheme,
  storePreference,
  watchSystemTheme,
} from './theme'

/** jsdom has no real media engine, so `prefers-color-scheme` is stubbed here. */
function stubSystemPrefersDark(dark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: dark && query.includes('dark'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  stubSystemPrefersDark(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('nextPreference', () => {
  it('cycles auto → light → dark → auto', () => {
    expect(nextPreference('auto')).toBe('light')
    expect(nextPreference('light')).toBe('dark')
    expect(nextPreference('dark')).toBe('auto')
  })
})

describe('readStoredPreference', () => {
  it('defaults to auto when nothing was ever stored', () => {
    expect(readStoredPreference()).toBe('auto')
  })

  it('returns a previously stored preference', () => {
    storePreference('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(readStoredPreference()).toBe('dark')
  })

  it('falls back to auto on a value it does not recognise', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'solarized')
    expect(readStoredPreference()).toBe('auto')
  })

  it('falls back to auto when storage is unavailable', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    expect(readStoredPreference()).toBe('auto')
  })
})

describe('resolveTheme', () => {
  it('passes explicit preferences through unchanged', () => {
    stubSystemPrefersDark(true)
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('follows the operating system under auto', () => {
    stubSystemPrefersDark(true)
    expect(resolveTheme('auto')).toBe('dark')
    stubSystemPrefersDark(false)
    expect(resolveTheme('auto')).toBe('light')
  })
})

describe('applyTheme', () => {
  it('always writes the resolved theme, never the auto preference', () => {
    stubSystemPrefersDark(true)
    expect(applyTheme('auto')).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    expect(applyTheme('light')).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})

/**
 * A media-query stub that can actually change its mind: `matches` flips and
 * the registered listeners are reachable, which is what the real OS event
 * does and what a `vi.fn()` addEventListener cannot express.
 */
function stubFlippableMedia(dark = false) {
  const listeners = new Set<() => void>()
  const query = {
    get matches() { return dark },
    addEventListener: (_: string, fn: () => void) => { listeners.add(fn) },
    removeEventListener: (_: string, fn: () => void) => { listeners.delete(fn) },
  }
  vi.stubGlobal('matchMedia', vi.fn(() => query))
  return {
    listenerCount: () => listeners.size,
    /** What the OS does when the user switches scheme. */
    flip(next: boolean) {
      dark = next
      listeners.forEach(fn => fn())
    },
  }
}

/**
 * Removing the `prefers-color-scheme` media query from index.css put the whole
 * auto path on this listener, so it is the only thing left that makes `auto`
 * follow the OS.
 */
describe('watchSystemTheme', () => {
  it('calls back when the operating system switches scheme', () => {
    const media = stubFlippableMedia(false)
    const onChange = vi.fn()

    watchSystemTheme(onChange)
    media.flip(true)

    expect(onChange).toHaveBeenCalledOnce()
  })

  it('resolves auto against the new scheme once the callback has run', () => {
    const media = stubFlippableMedia(false)
    watchSystemTheme(() => applyTheme('auto'))

    media.flip(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    media.flip(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('stops calling back after unsubscribing', () => {
    const media = stubFlippableMedia(false)
    const onChange = vi.fn()

    const stop = watchSystemTheme(onChange)
    stop()
    media.flip(true)

    expect(onChange).not.toHaveBeenCalled()
    expect(media.listenerCount()).toBe(0)
  })

  it('is inert where matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(() => watchSystemTheme(vi.fn())()).not.toThrow()
  })
})

/* The pre-paint script in index.html, as shipped. It is duplicated from this
   module on purpose — a module import would run after the first paint — so
   the duplicate is executed here rather than trusted. */
const inlineScript = indexHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ''

/** Runs the shipped script with everything it touches stubbed out. */
function prePaintTheme(stored: string | null, systemDark: boolean): string {
  const attributes: Record<string, string> = {}
  new Function('localStorage', 'matchMedia', 'document', inlineScript)(
    { getItem: () => stored },
    (query: string) => ({ matches: systemDark && query.includes('dark') }),
    { documentElement: { setAttribute: (k: string, v: string) => { attributes[k] = v } } },
  )
  return attributes['data-theme']
}

/**
 * The inline script exists to avoid a white flash, so any value it resolves
 * differently from this module produces exactly the flash it was added to
 * prevent — the bundle would immediately repaint the other way.
 */
describe('the pre-paint script in index.html', () => {
  const stored = [null, '', 'auto', 'light', 'dark', 'solarized']

  // Without this the table below would happily agree with an empty string if
  // the script were ever renamed, moved or given an attribute.
  it('was actually found in the shipped html', () => {
    expect(inlineScript).toContain(THEME_STORAGE_KEY)
    expect(inlineScript).toContain('data-theme')
  })

  it.each(stored.flatMap(value => [true, false].map(dark => [value, dark] as const)))(
    'agrees with lib/theme for %o with the OS on dark=%s',
    (value, dark) => {
      stubSystemPrefersDark(dark)
      if (value !== null) localStorage.setItem(THEME_STORAGE_KEY, value)

      expect(prePaintTheme(value, dark)).toBe(resolveTheme(readStoredPreference()))
    },
  )
})
