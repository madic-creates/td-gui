import { describe, expect, it } from 'vitest'
import { insertSlot } from './position'

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

  it('treats an unpinned card as having no index of its own', () => {
    // Gap 0 must stay a real move for a card arriving from the auto block.
    expect(insertSlot(0, null)).toBe(1)
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

  // The asymmetry that makes this function worth having: moving down by one is
  // gap = index + 2, because the card still occupies index + 1's left edge.
  it('moves a card down by one with the gap two below it', () => {
    // A at index 0 moving down: gap 2 → slot 3 → lands between B and C.
    expect(insertSlot(2, 0)).toBe(3)
  })
})
