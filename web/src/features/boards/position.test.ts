import { describe, expect, it } from 'vitest'
import { moveBeforeId } from './position'

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

  // Dropping a card immediately before or immediately after itself leaves the
  // order untouched, and issuing that request would rewrite a sort key and
  // possibly trigger a respacing pass for nothing.
  it('reports a no-op when a card is dropped onto its own place', () => {
    expect(moveBeforeId(1, 'td-bbb', pinned, auto)).toBeNull()
    expect(moveBeforeId(2, 'td-bbb', pinned, auto)).toBeNull()
    expect(moveBeforeId(0, 'td-aaa', pinned, auto)).toBeNull()
    expect(moveBeforeId(3, 'td-ccc', pinned, auto)).toBeNull()
  })

  // A card arriving from the query-ordered block has no place in the pinned
  // order yet, so every gap is a real move for it.
  it('treats an unpinned card as having no place of its own', () => {
    expect(moveBeforeId(2, 'td-ddd', pinned, auto)).toBe('td-ccc')
  })

  // "Move up" on index 0 computes gap -1, which names no place at all. Only a
  // disabled attribute two files away keeps that request unsent otherwise.
  it('reports a no-op for a gap before the start of the block', () => {
    expect(moveBeforeId(-1, 'td-aaa', pinned, auto)).toBeNull()
    expect(moveBeforeId(-1, 'td-ddd', pinned, auto)).toBeNull()
  })

  it('moves a card down by one with the gap two below it', () => {
    expect(moveBeforeId(2, 'td-aaa', pinned, auto)).toBe('td-ccc')
  })
})
