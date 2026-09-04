import { STATUS_LABEL } from '../../components/statusLabel'
import type { IssueStatus } from '../../api/types'
import type { Rollup } from './epicRollup'

/**
 * The bar's half of the status palette. StatusTag holds the text half and does
 * not export it; a second map is still cheaper than making that one public and
 * deriving `bg-` from `text-` by string surgery, which Tailwind cannot see
 * through and would compile away.
 *
 * Keyed by plain string with a fallback, like StatusTag's: a status td adds
 * later draws in the muted ink rather than as a gap in a bar whose segments
 * are supposed to add up to the total beside them.
 */
const SEGMENT: Record<string, string> = {
  open: 'bg-st-open',
  in_progress: 'bg-st-progress',
  in_review: 'bg-st-review',
  blocked: 'bg-st-blocked',
  closed: 'bg-st-closed',
}

const segmentClass = (status: string) => SEGMENT[status] ?? 'bg-ink-faint'

const labelFor = (status: string) => STATUS_LABEL[status as IssueStatus] ?? status

/**
 * How far the work under one issue has come: a bar segmented by status, the
 * closed-over-total count, and a legend naming what the segments are.
 *
 * Segmented rather than one tone, because most epics on the measured project
 * hold a single task, and `0/1` is then the whole story a single-tone bar can
 * tell — while whether that one task is untouched or already in review is
 * exactly what this page is opened to find out.
 *
 * The bar itself is `aria-hidden`. Everything it draws is also written beside
 * it in words, so labelling the graphic too would announce the same numbers
 * twice, once badly.
 */
export default function EpicProgress({ rollup }: { rollup: Rollup }) {
  // Its own state, not zero percent. Twenty-four of thirty epics on the
  // measured project have no tasks at all, and a bar pinned empty would draw
  // every one of them as work that has failed to move rather than work nobody
  // has broken down yet.
  if (rollup.total === 0) {
    return <span className="text-[11px] text-ink-faint">no tasks</span>
  }

  return (
    <span className="flex items-center gap-2">
      {/* A fixed width rather than a flexible one: several of these stack
          vertically in the overview, and a bar that sized itself to the space
          a row's title left over would make two epics with the same progress
          look different. */}
      <span
        aria-hidden="true"
        className="flex h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-line"
      >
        {rollup.buckets.map(bucket => (
          <span
            key={bucket.status}
            data-testid={`segment-${bucket.status}`}
            style={{ width: `${(bucket.count / rollup.total) * 100}%` }}
            className={segmentClass(bucket.status)}
          />
        ))}
      </span>

      <span className="shrink-0 font-mono text-[11px] text-ink-muted">
        {rollup.done}/{rollup.total}
      </span>

      {/* Only the statuses present, in the order the segments were drawn, so
          the legend is read against the bar left to right. */}
      <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-ink-faint">
        {rollup.buckets.map(bucket => (
          <span key={bucket.status} className="inline-flex items-center gap-1 whitespace-nowrap">
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-[1px] ${segmentClass(bucket.status)}`}
            />
            {labelFor(bucket.status)} {bucket.count}
          </span>
        ))}
      </span>
    </span>
  )
}
