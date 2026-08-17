/**
 * The issue list's column geometry, in one place.
 *
 * Three components lay out these columns today — the data row (IssueList),
 * the loading skeleton (SkeletonRows), and the sortable header row
 * (IssueListHeader), which import COL and ROW_LAYOUT. When the widths were
 * duplicated the row and the skeleton drifted apart by a pixel (fixed in
 * 4ce3b18); a third copy would make that certain.
 *
 * Sharing the classes also gives the skeleton bars the `shrink-0` the real
 * row's cells already had, so the two stay aligned when the viewport is too
 * narrow for the full row, not only when it is wide enough. `truncate` and
 * `text-right` come along the same way and are inert on an empty bar.
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
  // Wide enough for the header's "PRIO ▴", not just the cell's "P0" — the
  // header and the value share this column, so it is sized for the longer of
  // the two. Right-aligned to match the updated and status columns.
  priority: 'w-12 shrink-0 text-right',
  // Sized for the ISO date relativeTime falls back to past a week, not for the
  // relative form: "2026-07-24" renders 67.88px at the row's 13px, so it did
  // not fit the old 64px and broke after a hyphen into two lines. 74px matches
  // the id and status columns and leaves more slack than the id column already
  // lives with (its 9 mono chars measure 70.46px).
  //
  // whitespace-nowrap because the width rests on one machine's font stack, and
  // the header's sort button already nowraps for the same reason. It makes a
  // wider stack overhang by a pixel instead of wrapping — the row pins an
  // explicit height, so a second line is the worse of the two failures.
  updated: 'w-[74px] shrink-0 text-right whitespace-nowrap',
  status: 'w-[74px] shrink-0 text-right',
} as const
