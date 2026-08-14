export default function ConnectionBanner({ connected }: { connected: boolean }) {
  if (connected) return null
  return (
    <div
      role="status"
      className="border-b border-warn/30 bg-warn/10 px-4 py-1.5 text-[11px] text-warn"
    >
      Backend disconnected — the data shown may be out of date.
    </div>
  )
}
