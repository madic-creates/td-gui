export default function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="px-4 py-11 text-center">
      <p className="text-ink-muted">{message}</p>
      {hint && <p className="mt-1.5 text-[11px] text-ink-faint">{hint}</p>}
    </div>
  )
}
