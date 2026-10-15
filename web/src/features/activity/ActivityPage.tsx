import ActivityFeed from './ActivityFeed'
import SessionList from './SessionList'

/**
 * What has happened in the project lately, and which sessions did it.
 *
 * Both columns read td directly (`/v1/monitor`, `/v1/sessions`) and fail
 * independently. No width cap: see the comment in AppShell.
 */
export default function ActivityPage() {
  return (
    <div>
      <div className="flex items-center gap-2.5 border-b border-line bg-surface-inset px-4 py-2">
        <h1 className="text-[11px] uppercase tracking-widest text-ink-muted">Activity</h1>
      </div>
      <div className="grid gap-8 px-4 py-4 min-[900px]:grid-cols-[minmax(0,1fr)_20rem]">
        <ActivityFeed />
        <SessionList />
      </div>
    </div>
  )
}
