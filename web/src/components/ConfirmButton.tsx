import { useState } from 'react'

interface Props {
  label: string
  question: string
  /** Accessible name of the confirm control. Defaults to `Confirm <label>`. */
  confirmLabel?: string
  onConfirm: () => void
  disabled?: boolean
  className?: string
}

/**
 * Two-step confirmation in place. The app has no modal layer, and
 * window.confirm blocks the event loop and cannot carry the design tokens, so
 * the trigger swaps for a question and a confirm/cancel pair where it stands —
 * the same inline pattern TransitionBar uses for actions needing extra input.
 */
export default function ConfirmButton({
  label, question, confirmLabel, onConfirm, disabled, className = '',
}: Props) {
  const [armed, setArmed] = useState(false)

  if (!armed) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setArmed(true)}
        className={`rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted disabled:opacity-40 ${className}`}
      >
        {label}
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[11px] text-ink-muted">{question}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setArmed(false)
          onConfirm()
        }}
        className="rounded-sm border border-danger/40 px-2.5 py-1 text-[11px] text-danger disabled:opacity-40"
      >
        {confirmLabel ?? `Confirm ${label.toLowerCase()}`}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted"
      >
        Cancel
      </button>
    </span>
  )
}
