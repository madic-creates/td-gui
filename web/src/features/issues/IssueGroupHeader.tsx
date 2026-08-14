import StatusTag from '../../components/StatusTag'

/* Background twins of StatusTag's text colours. Tailwind needs the class names
   to appear literally, so this cannot be built by interpolation. */
const statusBar: Record<string, string> = {
  open: 'bg-st-open',
  in_progress: 'bg-st-progress',
  in_review: 'bg-st-review',
  blocked: 'bg-st-blocked',
  closed: 'bg-st-closed',
}

/**
 * Opens a status section. The colour never carries the meaning on its own —
 * the status name sits right next to the bar — so the grouping survives
 * without colour perception.
 */
export default function IssueGroupHeader({
  status,
  count,
}: {
  status: string
  count: number
}) {
  return (
    <div className="flex items-center gap-3 border-y border-line bg-surface-inset px-4 py-1.5">
      <span
        aria-hidden="true"
        className={`h-3.5 w-0.5 rounded-full ${statusBar[status] ?? 'bg-line'}`}
      />
      <StatusTag status={status} />
      <span className="flex-1" />
      <span className="font-mono text-[11px] text-ink-faint">{count}</span>
    </div>
  )
}
