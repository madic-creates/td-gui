import { useSyncExternalStore, type ReactNode } from 'react'
import Icon from './Icon'
import { getMode, otherMode, setMode, subscribe, type ProseMode } from '../lib/prose'

/* Paths for the shared Icon frame, which supplies the 16-box and the ink. */
const icons: Record<ProseMode, ReactNode> = {
  // A short heading over full body lines: text that has been given a shape.
  markdown: <path d="M2.5 3.5h6.5M2.5 7h11M2.5 10.5h11M2.5 14h7" />,
  // Chevrons, the long-standing shorthand for source.
  raw: <path d="M6 4L2.5 8 6 12M10 4l3.5 4-3.5 4" />,
}

/**
 * Switches every Markdown-rendered surface between the rendered text and the
 * source td stored. Sits beside ThemeToggle because it is the same kind of
 * control: a display preference that belongs to the reader, not to an issue.
 *
 * Two states, so it toggles rather than cycles, and the label carries the
 * current one because an icon alone cannot say which side of a switch it is on.
 */
export default function ProseToggle() {
  const mode = useSyncExternalStore(subscribe, getMode)
  const next = otherMode(mode)
  const label = `Text: ${mode}. Switch to ${next}.`

  return (
    <button
      type="button"
      onClick={() => setMode(next)}
      aria-label={label}
      title={label}
      className="flex items-center gap-1.5 rounded-sm border border-line px-2.5 py-1 text-[11px] capitalize text-ink-muted"
    >
      <Icon>{icons[mode]}</Icon>
      {mode}
    </button>
  )
}
