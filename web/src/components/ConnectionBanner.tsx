export default function ConnectionBanner({ connected }: { connected: boolean }) {
  if (connected) return null
  return (
    <div role="status" className="bg-amber-100 px-6 py-2 text-sm text-amber-900">
      Backend disconnected — the data shown may be out of date.
    </div>
  )
}
