import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  THEME_STORAGE_KEY,
  applyTheme,
  nextPreference,
  readStoredPreference,
  resolveTheme,
  storePreference,
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
