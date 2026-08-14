const statusColor: Record<string, string> = {
  open: 'text-st-open',
  in_progress: 'text-st-progress',
  in_review: 'text-st-review',
  blocked: 'text-st-blocked',
  closed: 'text-st-closed',
}

/**
 * Takes a plain string rather than IssueStatus: a status td adds later should
 * render, not crash the list.
 */
export default function StatusTag({ status }: { status: string }) {
  return (
    <span className={`text-[10px] tracking-wider ${statusColor[status] ?? 'text-ink-muted'}`}>
      {status}
    </span>
  )
}
