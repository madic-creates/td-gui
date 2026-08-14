/**
 * Placeholder rows at the real row height, so nothing jumps when data lands.
 *
 * Row height comes from the shared `--spacing-row` token (index.css), used
 * here via `h-row` and on the real row in IssueList.tsx, so the two cannot
 * drift apart again. This skeleton's children carry no text, so a bare flex
 * row would size to its tallest child (~11px) instead — hence the explicit
 * height. The id and status bars are also sized to match the real row's
 * `w-[74px]` columns exactly.
 */
export default function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading issues">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="flex h-row items-center gap-3 border-b border-line-subtle px-4 py-2"
        >
          <span className="h-[11px] w-[74px] rounded-sm bg-surface-hover" />
          <span className="h-[11px] flex-1 rounded-sm bg-surface-hover" />
          <span className="h-[11px] w-5 rounded-sm bg-surface-hover" />
          <span className="h-[11px] w-[74px] rounded-sm bg-surface-hover" />
        </div>
      ))}
    </div>
  )
}
