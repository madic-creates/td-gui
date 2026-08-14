import type { ReactNode } from 'react'
import { Link } from 'react-router'
import ConnectionBanner from './ConnectionBanner'

/**
 * Connection state is shown twice on purpose: the header dot is the ambient
 * state, the banner is the consequence — the data may be stale.
 */
export default function AppShell({
  connected,
  children,
}: {
  connected: boolean
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-surface text-ink">
      <header className="flex items-center gap-2.5 border-b border-line bg-surface-inset px-4 py-2.5">
        <Link to="/" className="font-mono font-semibold tracking-widest text-accent">td-gui</Link>
        <span className="flex-1" />
        <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-success' : 'bg-warn'}`}
          />
          {connected ? 'connected' : 'disconnected'}
        </span>
        <Link
          to="/new"
          className="rounded-sm border border-accent px-2.5 py-1 text-[11px] text-accent"
        >
          New issue
        </Link>
      </header>

      <ConnectionBanner connected={connected} />

      <main>{children}</main>
    </div>
  )
}
