import { describe, expect, it } from 'vitest'
import { insertSlot, moveBeforeId } from './position'

/*
 * td's ComputeInsertPosition reads the stored rows INCLUDING the card being
 * moved, so a gap is an index into the pinned block as currently rendered and
 * the slot is simply gap + 1. Given pinned [A, B, C] with keys 1000/2000/3000:
 *
 *   slot 1 → before A          (key 0)
 *   slot 2 → between A and B   (key 1500)
 *   slot 3 → between B and C   (key 2500)
 *   slot 4 → after C           (key 4000)
 */
describe('insertSlot', () => {
  it('maps a gap to the slot after it', () => {
    expect(insertSlot(0, null)).toBe(1)
    expect(insertSlot(1, null)).toBe(2)
    expect(insertSlot(3, null)).toBe(4)
  })

  // A card arriving from the auto block has no place in the pinned order yet,
  // so no gap can be "its own place" and every gap is a real move — including
  // the ones that are refused for a card already sitting at that index.
  it('treats an unpinned card as having no index of its own', () => {
    expect(insertSlot(2, 2)).toBeNull()
    expect(insertSlot(2, null)).toBe(3)
  })

  // Dropping a card immediately before or immediately after itself leaves the
  // order untouched: at gap = cardIndex + 1 td interpolates between the card
  // and its successor and the card keeps its place. Issuing that request would
  // rewrite a sort key and possibly trigger a respacing pass for nothing.
  it('reports a no-op when a card is dropped onto its own place', () => {
    expect(insertSlot(1, 1)).toBeNull()
    expect(insertSlot(2, 1)).toBeNull()
    expect(insertSlot(0, 0)).toBeNull()
    expect(insertSlot(1, 0)).toBeNull()
  })

  it('moves a card up by one with the gap before its predecessor', () => {
    // C at index 2 moving up: gap 1 → slot 2 → lands between A and B.
    expect(insertSlot(1, 2)).toBe(2)
  })

  // "Move up" on index 0 computes gap -1, and gap + 1 would be slot 0 — not a
  // 1-based slot at all. Only a disabled attribute two files away keeps that
  // request unsent today. This function is documented as the owner of the
  // conversion, so it refuses the gap itself.
  it('reports a no-op for a gap before the start of the block', () => {
    expect(insertSlot(-1, 0)).toBeNull()
    expect(insertSlot(-1, null)).toBeNull()
    expect(insertSlot(-2, 3)).toBeNull()
  })

  // The asymmetry that makes this function worth having: moving down by one is
  // gap = index + 2, because the card still occupies index + 1's left edge.
  it('moves a card down by one with the gap two below it', () => {
    // A at index 0 moving down: gap 2 → slot 3 → lands between B and C.
    expect(insertSlot(2, 0)).toBe(3)
  })
})

/*
 * td's move endpoint takes the card to land before, not a slot, and reads the
 * board as one list: pinned cards first, then the query-ordered ones. A
 * missing before_id moves a card to the very end of that list and pins every
 * card above it, so "end of the pinned block" has to name the first
 * query-ordered card instead. Pinned [A, B, C], query-ordered [D, E].
 */
describe('moveBeforeId', () => {
  const pinned = ['td-aaa', 'td-bbb', 'td-ccc']
  const auto = ['td-ddd', 'td-eee']

  it('names the pinned card that sits at the gap', () => {
    expect(moveBeforeId(0, 'td-ddd', pinned, auto)).toBe('td-aaa')
    expect(moveBeforeId(1, 'td-ccc', pinned, auto)).toBe('td-bbb')
  })

  it('names the first query-ordered card for the end of the pinned block', () => {
    expect(moveBeforeId(3, 'td-aaa', pinned, auto)).toBe('td-ddd')
  })

  // The dragged card is still rendered at its old place, so the card after the
  // pinned block can be the very card being pinned. Landing before itself is
  // not a place; the one after it is.
  it('skips the dragged card itself when it heads the query-ordered block', () => {
    expect(moveBeforeId(3, 'td-ddd', pinned, auto)).toBe('td-eee')
  })

  // With nothing below the pinned block, the end of the board is the end of
  // the block, and every card above is already pinned.
  it('sends the end of the board when nothing follows the pinned block', () => {
    expect(moveBeforeId(3, 'td-aaa', pinned, [])).toBe('')
    expect(moveBeforeId(3, 'td-ddd', pinned, ['td-ddd'])).toBe('')
  })

  it('names the first query-ordered card on a board with nothing pinned', () => {
    expect(moveBeforeId(0, 'td-eee', [], auto)).toBe('td-ddd')
  })

  it('reports the same no-ops as insertSlot', () => {
    expect(moveBeforeId(1, 'td-bbb', pinned, auto)).toBeNull()
    expect(moveBeforeId(2, 'td-bbb', pinned, auto)).toBeNull()
    expect(moveBeforeId(-1, 'td-aaa', pinned, auto)).toBeNull()
  })

  it('moves a card down by one with the gap two below it', () => {
    expect(moveBeforeId(2, 'td-aaa', pinned, auto)).toBe('td-ccc')
  })
})
