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
 * immediately after itself changes nothing, and the request must not be sent.
 *
 * The returned slot is 1-based and counts only cards that already have a
 * position. It is never the `position` field read back from the board, which
 * is a sparse sort key.
 */
export function insertSlot(gap: number, cardIndex: number | null): number | null {
  if (cardIndex !== null && (gap === cardIndex || gap === cardIndex + 1)) return null
  return gap + 1
}
