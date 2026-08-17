import { useEffect, useRef, useState } from 'react'

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
        className="inline-flex items-center rounded-sm border border-line p-1 text-ink-muted"
      >
        {/* Two sheets, the back one drawn as the L its front neighbour leaves
            visible — the same 16-box line icon ThemeToggle uses, in
            currentColor so it inherits whatever ink the row is written in.
            aria-hidden: the button's name is the label, and an unnamed shape
            announced beside it would only repeat it badly. */}
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
          <rect x="6" y="6" width="8" height="8" rx="1.5" />
          <path d="M10 6V3.5A1 1 0 0 0 9 2.5H3.5a1 1 0 0 0-1 1V9a1 1 0 0 0 1 1H6" />
        </svg>
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
