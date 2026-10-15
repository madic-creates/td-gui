/**
 * Where a card lands, as td wants to hear it.
 *
 * `gap` is an index into the pinned block *as currently rendered, including the
 * card being moved* — the card lands before whatever now sits at `gap`, and
 * `gap === pinned.length` appends. td's ComputeInsertPosition reads the stored
 * rows the same way, so the mapping is simply `gap + 1`.
 *
 * `cardIndex` is the card's own index in that block, or null when it is not
 * pinned yet. Returns null for a no-op — dropping a card immediately before or
 * immediately after itself changes nothing, and the request must not be sent —
 * and for a gap outside the block's lower edge, which "Move up" on index 0
 * computes and which has no 1-based slot to map to.
 *
 * The returned slot is 1-based and counts only cards that already have a
 * position. It is never the `position` field read back from the board, which
 * is a sparse sort key.
 */
export function insertSlot(gap: number, cardIndex: number | null): number | null {
  if (gap < 0) return null
  if (cardIndex !== null && (gap === cardIndex || gap === cardIndex + 1)) return null
  return gap + 1
}

/**
 * The same drop, as td's move endpoint wants to hear it: the id of the card to
 * land before, `''` for the end of the board, or null for the no-ops
 * `insertSlot` refuses.
 *
 * `gap` means what it means above. `pinned` and `auto` are the two blocks'
 * ids as rendered, the dragged card still in its old place.
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
  const index = pinned.indexOf(issueId)
  if (insertSlot(gap, index === -1 ? null : index) === null) return null
  if (gap < pinned.length) return pinned[gap]
  return auto.find(id => id !== issueId) ?? ''
}
