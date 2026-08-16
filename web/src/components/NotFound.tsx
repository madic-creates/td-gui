import { Link } from 'react-router'

export default function NotFound() {
  return (
    <div className="p-4">
      <p className="mb-1.5 text-[11px] uppercase tracking-widest text-ink-muted">
        Page not found
      </p>
      <p className="text-ink-muted">There&apos;s nothing at this address.</p>
      <Link to="/" className="mt-3 inline-block text-[11px] text-ink-muted underline">
        back to list
      </Link>
    </div>
  )
}
