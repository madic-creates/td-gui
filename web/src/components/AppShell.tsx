import type { ReactNode } from 'react'
import { Link } from 'react-router'
import ConnectionBanner from './ConnectionBanner'
import ThemeToggle from './ThemeToggle'

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
      {/* Nothing here caps the width. A 1440px cap was tried and taken back
          out: it left the detail view's prose squeezed while a third of the
          window sat empty beside it, and it clipped the list and board
          toolbars, whose rules used to reach the window edges. Making those
          reach again from inside a capped <main> needs a 100vw breakout, and
          vw includes the scrollbar while percentage margins do not — that
          combination scrolls the page sideways by half a scrollbar width on
          every page tall enough to scroll. Views own their own padding. */}
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
        <ThemeToggle />
        <Link
          to="/boards"
          data-button
          className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted"
        >
          Boards
        </Link>
        <Link
          to="/new"
          data-button
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
