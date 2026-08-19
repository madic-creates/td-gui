import { useEffect, useRef, useState } from 'react'
import { CopyIcon } from './Icon'

/** How long an outcome stays on screen before the control returns to idle. */
const RESET_MS = 2000

type Outcome = 'idle' | 'copied' | 'failed'

interface Props {
  /** The text written to the clipboard. */
  value: string
  /**
   * Accessible name of the trigger, and its tooltip. The icon says "copy" and
   * nothing about what, so this has to: `Copy issue id`, not `Copy`.
   */
  label: string
  /**
   * Visible text inside the button, for a page-level action that has no
   * nearby value to explain it. Omitted, the button stays icon-only.
   *
   * Must read the same as `label` where both are set: `label` becomes the
   * accessible name and would otherwise override the words on screen, leaving
   * a control that cannot be asked for by the name a user can see.
   */
  text?: string
  className?: string
}

/**
 * Copies a short value to the clipboard and says whether it worked.
 *
 * The trigger is an icon, so `label` is the whole of its accessible name and
 * its tooltip — there is no visible text to fall back on.
 *
 * The outcome sits in a live region beside the button rather than in the
 * button itself: a control that relabels itself mid-interaction is announced
 * as a different control, and its name has to keep saying what the button
 * does, not what just happened.
 *
 * A failure here is ordinary rather than exceptional — `navigator.clipboard`
 * is absent outside a secure context, and `writeText` rejects when the
 * document is not focused or the permission was denied. Swallowing that would
 * look exactly like a successful copy, and the next paste would produce
 * whatever the clipboard held before.
 */
export default function CopyButton({ value, label, text, className = '' }: Props) {
  const [outcome, setOutcome] = useState<Outcome>('idle')

  // Cleared on every settle, so a second click restarts the window instead of
  // inheriting what was left of the first one's, and on unmount, so a pending
  // timer cannot fire into a component that is gone.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const settle = (next: Outcome) => {
    setOutcome(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOutcome('idle'), RESET_MS)
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value)
            settle('copied')
          } catch {
            settle('failed')
          }
        }}
        className={`inline-flex items-center rounded-sm border border-line text-ink-muted ${
          text ? 'gap-1.5 px-2.5 py-1 text-[11px]' : 'p-1'
        }`}
      >
        <CopyIcon />
        {text}
      </button>
      {/* Mounted in every state and empty while idle. A live region that
          appears with its message already inside it is not reliably
          announced — the region has to be there for the change to be one. */}
      <span
        role="status"
        className={outcome === 'failed' ? 'text-danger' : 'text-ink-faint'}
      >
        {outcome === 'copied' && 'copied'}
        {outcome === 'failed' && 'copy failed'}
      </span>
    </span>
  )
}
