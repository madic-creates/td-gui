/**
 * Theme preference: what the user picked. `auto` is not a theme, it is the
 * absence of a choice — it defers to the operating system.
 */
export type ThemePreference = 'auto' | 'light' | 'dark'

/** What actually gets painted. `auto` is always resolved away before use. */
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'td-gui.theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/* Cycle order. `auto` first so the button's first press moves away from the
   default rather than into it. */
const CYCLE: ThemePreference[] = ['auto', 'light', 'dark']

export function nextPreference(current: ThemePreference): ThemePreference {
  return CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length]
}

function isPreference(value: unknown): value is ThemePreference {
  return CYCLE.includes(value as ThemePreference)
}

/**
 * Reading localStorage throws outright in some sandboxed contexts, so a
 * missing, unreadable or unrecognised value all degrade to `auto`.
 */
export function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return isPreference(stored) ? stored : 'auto'
  } catch {
    return 'auto'
  }
}

export function storePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    /* A theme that survives only this tab still beats a crash. */
  }
}

export function systemTheme(): ResolvedTheme {
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches
    ? 'dark'
    : 'light'
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'auto' ? systemTheme() : preference
}

/**
 * Writes the *resolved* theme to `<html data-theme>`, never the preference —
 * so the stylesheet only ever needs to know about `light` and `dark`, and the
 * dark token block is not duplicated between a media query and an attribute
 * selector.
 */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference)
  document.documentElement.setAttribute('data-theme', resolved)
  return resolved
}

/**
 * Calls back when the OS scheme changes. Only meaningful under `auto`;
 * callers unsubscribe with the returned function.
 */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => {}
  const query = matchMedia(DARK_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
