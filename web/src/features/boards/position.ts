/**
 * Where a card lands, as td's move endpoint wants to hear it: the id of the
 * card to land before, `''` for the end of the board, or null for a no-op.
 *
 * `gap` is an index into the pinned block *as currently rendered, including the
 * card being moved*: the card lands before whatever now sits at `gap`, and
 * `gap === pinned.length` is the end of the block. `pinned` and `auto` are the
 * two blocks' ids as rendered, the dragged card still in its old place.
 *
 * Dropping a card immediately before or immediately after itself changes
 * nothing, and the request must not be sent. Nor is a gap outside the block's
 * lower edge, which "Move up" on index 0 computes, a place to land.
 *
 * td reads the board as one list, pinned cards first, and a move to the end
 * of it pins every card above. So the end of the pinned block is "before the
 * first query-ordered card", which pins only the card being moved; the empty
 * id is sent only when no other card follows the block.
 */
export function moveBeforeId(
  gap: number,
  issueId: string,
  pinned: string[],
  auto: string[],
): string | null {
  if (gap < 0) return null
  const index = pinned.indexOf(issueId)
  if (index !== -1 && (gap === index || gap === index + 1)) return null
  if (gap < pinned.length) return pinned[gap]
  return auto.find(id => id !== issueId) ?? ''
}
