import { expect } from 'vitest'
import { screen } from '@testing-library/react'

/**
 * Asserts that td's message for one field is announced and belongs to an
 * input — the two halves of `FieldError` and `fieldAria`, checked together.
 *
 * Deliberately derivation-free: it finds the message by its text, then finds
 * the input by that message's id rather than by a label. Four suites run this
 * over fields whose accessible names it does not know, and a name-to-field map
 * would be one more hand-maintained list going stale exactly where a stale
 * list is silent.
 *
 * Test-only, and shared because the two `boundFields` guards, BoardForm and
 * CommentForm all make the same assertion about the same pair.
 */
export async function expectAnnouncedAtItsInput(message: string): Promise<void> {
  const rendered = await screen.findByText(message)
  expect(rendered).toHaveAttribute('role', 'alert')
  expect(rendered.id).not.toBe('')
  expect(document.querySelector(`[aria-describedby~="${rendered.id}"]`)).toBeInvalid()
}
