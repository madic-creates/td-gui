import { useState, type ReactNode } from 'react'

interface Props {
  label: string
  /**
   * Accessible name of the trigger, when the visible label alone would not say
   * which of several identical controls this is. Defaults to `label`.
   */
  ariaLabel?: string
  /**
   * Drawn in place of the label, for a trigger that sits in a row of
   * metadata rather than in a bar of actions. The button then has no text at
   * all, so its name falls back to `label` when no `ariaLabel` is given —
   * unnamed is not an option the way it is for a trigger that reads
   * "Delete".
   */
  icon?: ReactNode
  question: string
  /** Visible text of the confirm control. Defaults to `Confirm <label>`. */
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
  label, ariaLabel, icon, question, confirmLabel, onConfirm, disabled, className = '',
}: Props) {
  const [armed, setArmed] = useState(false)

  // The trigger's name says which row this is; the pair that replaces it has
  // to keep saying so, or two rows armed at once expose two controls both
  // named "Confirm remove". Derived here rather than per call site, because a
  // call site that forgets is silently ambiguous again. Only the verb is
  // lowered — ariaLabel carries user data, and lowering the lot would turn
  // "Delete Sprint 1" into "confirm delete sprint 1".
  const armedName = (verb: string) =>
    ariaLabel && `${verb} ${ariaLabel[0].toLowerCase()}${ariaLabel.slice(1)}`

  if (!armed) {
    // The icon trigger is square and tighter than the text one, and it takes
    // a tooltip: a shape in a row of metadata is the one control here a
    // pointer user cannot read.
    const name = icon ? ariaLabel ?? label : ariaLabel
    return (
      <button
        type="button"
        aria-label={name}
        title={icon ? name : undefined}
        disabled={disabled}
        onClick={() => setArmed(true)}
        className={`inline-flex items-center rounded-sm border border-line text-[11px] text-ink-muted disabled:opacity-40 ${icon ? 'p-1' : 'px-2.5 py-1'} ${className}`}
      >
        {icon ?? label}
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[11px] text-ink-muted">{question}</span>
      <button
        type="button"
        aria-label={armedName('Confirm')}
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
        aria-label={armedName('Cancel')}
        onClick={() => setArmed(false)}
        className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted"
      >
        Cancel
      </button>
    </span>
  )
}
