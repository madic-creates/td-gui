import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useAbout } from '../api/queries'
import ConnectionBanner from './ConnectionBanner'
import { AboutIcon } from './Icon'
import ProseToggle from './ProseToggle'
import ThemeToggle from './ThemeToggle'

/**
 * Last segment of the project path, which is the name a user thinks in.
 *
 * Split on both separators: `portfile_windows.go` exists, so Windows paths
 * reach this code. Trailing separators are dropped rather than yielding an
 * empty name.
 */
function projectName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

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
  // Undefined while the request is in flight and after it fails. Absence of a
  // name is not a name: the header and the tab keep saying plain `td-gui`
  // rather than showing an error a reader could do nothing about.
  const { data } = useAbout()
  const project = data && projectName(data.project)

  // The tab strip is where several td-gui windows are actually told apart,
  // which the static <title> in index.html could never do.
  useEffect(() => {
    document.title = project ? `td-gui — ${project}` : 'td-gui'
  }, [project])

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
        {project && (
          <>
            {/* Separator only — the name beside it says everything. */}
            <span aria-hidden="true" className="text-ink-faint">/</span>
            <span className="font-mono text-[11px] text-ink-muted">{project}</span>
          </>
        )}
        <span className="flex-1" />
        <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-success' : 'bg-warn'}`}
          />
          {connected ? 'connected' : 'disconnected'}
        </span>
        <ProseToggle />
        <ThemeToggle />
        {/* The one icon-only control in the header. Its neighbours are
            toggles whose label states which side of the switch they are on,
            which an icon cannot say; a link to a page has no such state, so a
            label would only repeat the glyph. */}
        <Link
          to="/about"
          data-button
          aria-label="About"
          title="About"
          className="flex items-center rounded-sm border border-line p-1 text-ink-muted"
        >
          <AboutIcon />
        </Link>
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
