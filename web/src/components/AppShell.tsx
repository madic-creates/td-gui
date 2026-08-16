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
      {/* The border spans the window; only the contents centre. A cap on the
          <header> itself would stop the rule short of both edges and read as a
          boxed panel rather than the top of the page. That's specific to the
          header, though — it's a sibling of <main>, not a descendant. Bars
          inside <main> (the issue list and board toolbars) end at the same
          1440px cap as everything else there, on purpose. */}
      <header className="border-b border-line bg-surface-inset">
        <div className="mx-auto flex w-full max-w-[1440px] items-center gap-2.5 px-4 py-2.5">
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
        </div>
      </header>

      {/* Full-bleed on purpose: this warns about the whole app, not about the
          view inside the capped column. */}
      <ConnectionBanner connected={connected} />

      <main className="mx-auto w-full max-w-[1440px]">{children}</main>
    </div>
  )
}
