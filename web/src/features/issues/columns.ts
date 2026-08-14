/**
 * The issue list's column geometry, in one place.
 *
 * Three components lay out the same columns: the data row (IssueList), the
 * loading skeleton (SkeletonRows) and the sortable header (IssueListHeader).
 * When the widths were duplicated the row and the skeleton drifted apart by a
 * pixel (fixed in 4ce3b18) — with a third copy that is a matter of time.
 *
 * ROW keeps h-row, the border and the padding on ONE element, because under
 * box-sizing: border-box an explicit height on that element fixes the rendered
 * total regardless of the padding. Splitting them across two boxes is what
 * caused the drift.
 */
export const ROW_LAYOUT = 'flex items-center gap-3 px-4'

export const ROW = `${ROW_LAYOUT} h-row border-b border-line-subtle py-2`

export const COL = {
  id: 'w-[74px] shrink-0',
  title: 'flex-1 truncate',
  // w-7, not the skeleton's old w-5: the real row never constrained the
  // priority tag before, and "P0" in semibold mono needs the headroom.
  priority: 'w-7 shrink-0',
  updated: 'w-[64px] shrink-0 text-right',
  status: 'w-[74px] shrink-0 text-right',
} as const
