const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/**
 * Renders an ISO timestamp as a relative string, falling back to an absolute
 * date once it is a week old. Returns '' for anything unparseable so a bad
 * timestamp shows as nothing rather than "Invalid Date".
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''

  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000)
  if (seconds < MINUTE) return 'just now'
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m ago`
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h ago`
  if (seconds < WEEK) return `${Math.floor(seconds / DAY)}d ago`
  return then.toISOString().slice(0, 10)
}

/** td session ids look like `ses_d87edf`; the prefix carries no information. */
export function shortSession(id: string): string {
  return id.replace(/^ses_/, '').slice(0, 4)
}
