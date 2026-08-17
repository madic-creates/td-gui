import { useEffect, useRef, useState } from 'react'

/** How long an outcome stays on screen before the control returns to idle. */
const RESET_MS = 2000

type Outcome = 'idle' | 'copied' | 'failed'

interface Props {
  /** The text written to the clipboard. */
  value: string
  /**
   * Accessible name of the trigger. The visible label is the bare word
   * `copy`, which does not say what would be copied once a page holds more
   * than one of these.
   */
  label: string
  className?: string
}

/**
 * Copies a short value to the clipboard and says whether it worked.
 *
 * The outcome sits in a live region beside the button rather than replacing
 * the button's own text: a control that renames itself mid-interaction is
 * announced as a different control, and its name has to keep saying what the
 * button does, not what just happened.
 *
 * A failure here is ordinary rather than exceptional — `navigator.clipboard`
 * is absent outside a secure context, and `writeText` rejects when the
 * document is not focused or the permission was denied. Swallowing that would
 * look exactly like a successful copy, and the next paste would produce
 * whatever the clipboard held before.
 */
export default function CopyButton({ value, label, className = '' }: Props) {
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
    <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
      <button
        type="button"
        aria-label={label}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value)
            settle('copied')
          } catch {
            settle('failed')
          }
        }}
        className="rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-ink-muted"
      >
        copy
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
