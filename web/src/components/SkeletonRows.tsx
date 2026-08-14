import { COL, ROW } from '../features/issues/columns'

/**
 * Placeholder rows at the real row height, so the rows themselves do not jump
 * when data lands. The surrounding chrome — the column-header row, a group
 * header per status, and sometimes the cap notice — has no placeholder here
 * and does appear on load; only the row geometry is pinned in advance.
 *
 * Geometry comes from the shared columns module, so this cannot drift from the
 * real row. The bars carry no text, so a bare flex row would size to its
 * tallest child (~11px) — the height in ROW is what prevents that.
 */
export default function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading issues">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden="true" className={ROW}>
          <span className={`${COL.id} h-[11px] rounded-sm bg-surface-hover`} />
          <span className={`${COL.title} h-[11px] rounded-sm bg-surface-hover`} />
          <span className={`${COL.priority} h-[11px] rounded-sm bg-surface-hover`} />
          <span className={`${COL.updated} h-[11px] rounded-sm bg-surface-hover`} />
          <span className={`${COL.status} h-[11px] rounded-sm bg-surface-hover`} />
        </div>
      ))}
    </div>
  )
}
