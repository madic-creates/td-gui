import { useEffect, useState, type ReactNode } from 'react'
import {
  applyTheme,
  nextPreference,
  readStoredPreference,
  storePreference,
  watchSystemTheme,
  type ThemePreference,
} from '../lib/theme'

/* 12px line icons, drawn in currentColor so they inherit the header's ink. */
const icons: Record<ThemePreference, ReactNode> = {
  light: (
    <>
      <circle cx="8" cy="8" r="3.25" />
      <path d="M8 1v1.75M8 13.25V15M15 8h-1.75M2.75 8H1M12.95 3.05l-1.24 1.24M4.29 11.71l-1.24 1.24M12.95 12.95l-1.24-1.24M4.29 4.29L3.05 3.05" />
    </>
  ),
  dark: <path d="M13.5 9.7A6 6 0 0 1 6.3 2.5a6 6 0 1 0 7.2 7.2z" />,
  // Half-lit disc: the theme is decided elsewhere, so the icon shows both.
  auto: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 2.25a5.75 5.75 0 0 1 0 11.5z" fill="currentColor" stroke="none" />
    </>
  ),
}

/**
 * Cycles the theme preference. A single button rather than three controls:
 * the header has room for one quiet affordance, and the current state stays
 * readable because the label spells it out.
 */
export default function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>(readStoredPreference)

  useEffect(() => {
    applyTheme(preference)
    // Under an explicit choice the OS is irrelevant; under `auto` the page has
    // to repaint when the OS flips, which no CSS is watching for any more.
    if (preference !== 'auto') return
    return watchSystemTheme(() => applyTheme('auto'))
  }, [preference])

  const next = nextPreference(preference)

  return (
    <button
      type="button"
      onClick={() => {
        storePreference(next)
        setPreference(next)
      }}
      aria-label={`Theme: ${preference}. Switch to ${next}.`}
      title={`Theme: ${preference}. Switch to ${next}.`}
      className="flex items-center gap-1.5 rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="h-3 w-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {icons[preference]}
      </svg>
      {preference}
    </button>
  )
}
