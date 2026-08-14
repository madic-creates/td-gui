/**
 * Placeholder rows at the real row height, so nothing jumps when data lands.
 *
 * A real row (IssueList.tsx) is a `px-4 py-2` link with 12px/1.5 body text,
 * so its box is 8px + 18px line box + 8px = 34px, plus the row's 1px
 * bottom border = 35px. This skeleton's children carry no text, so a bare
 * flex row would size to its tallest child (~11px) instead — hence the
 * explicit `h-[35px]`, which (with border-box sizing) reproduces the same
 * 34px content+padding area under the same 1px border. The id and status
 * bars are also sized to match the real row's `w-[74px]` columns exactly.
 */
export default function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading issues">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="flex h-[35px] items-center gap-3 border-b border-line-subtle px-4 py-2"
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
