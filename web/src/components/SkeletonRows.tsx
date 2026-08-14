/** Placeholder rows at the real row height, so nothing jumps when data lands. */
export default function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading issues">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="flex items-center gap-3 border-b border-line-subtle px-4 py-2"
        >
          <span className="h-[11px] w-[74px] rounded-sm bg-surface-hover" />
          <span className="h-[11px] flex-1 rounded-sm bg-surface-hover" />
          <span className="h-[11px] w-5 rounded-sm bg-surface-hover" />
          <span className="h-[11px] w-[66px] rounded-sm bg-surface-hover" />
        </div>
      ))}
    </div>
  )
}
