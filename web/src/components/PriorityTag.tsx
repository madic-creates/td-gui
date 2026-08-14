export default function PriorityTag({ priority }: { priority: string }) {
  const urgent = priority === 'P0' || priority === 'P1'
  return (
    <span className={`font-mono ${urgent ? 'font-semibold text-danger' : 'text-ink-muted'}`}>
      {priority}
    </span>
  )
}
