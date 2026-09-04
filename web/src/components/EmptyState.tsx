import type { ReactNode } from 'react'

/**
 * `action` is the one way out of the empty state, for a view where the control
 * that fills it is not already on screen. Optional, and most callers leave it
 * off: the issue list and the board list both keep their create button in a
 * toolbar that stays mounted through the empty state, so a second copy of it
 * here would be the same control twice.
 */
export default function EmptyState({ message, hint, action }: {
  message: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="px-4 py-11 text-center">
      <p className="text-ink-muted">{message}</p>
      {hint && <p className="mt-1.5 text-[11px] text-ink-faint">{hint}</p>}
      {action && <p className="mt-3.5">{action}</p>}
    </div>
  )
}
