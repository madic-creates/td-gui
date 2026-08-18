import { fieldErrorFor } from '../api/client'

interface Props {
  /** A rejected mutation's error. Anything else renders nothing. */
  error: unknown
  /** td's own name for the field, as it appears in `details.fields`. */
  field: string
  /**
   * The `id` of the input this message belongs under. The message derives its
   * own id from it, so the caller passes the id it already has rather than
   * inventing a second one for the two halves to keep in step.
   */
  inputId: string
}

/**
 * The message's id, derived from its input's. Exported so a caller can point
 * at it, but the suffix itself is nobody's business — both halves of the pair
 * go through this function, which is what keeps them agreeing.
 */
// oxlint-disable-next-line react/only-export-components
export function errorIdFor(inputId: string): string {
  return `${inputId}-error`
}

/** What `fieldAria` spreads onto an input. Nothing when there is no message. */
export interface FieldAria {
  'aria-invalid'?: true
  'aria-describedby'?: string
}

/**
 * The input half of the pair: marks the input invalid and points it at the
 * message `FieldError` renders for the same field.
 *
 * `describedBy` is whatever the input already described itself with, and it
 * survives — the error id is appended to it, never put in its place.
 * `description`, `acceptance` and the comment box all carry a MarkdownHint,
 * and `IssueCombobox` its cap notice; overwriting that would trade one
 * silence for another.
 *
 * Safe to spread unconditionally: with no message for this field it returns
 * the description unchanged, or nothing at all, and leaves the input valid.
 */
// oxlint-disable-next-line react/only-export-components
export function fieldAria(
  error: unknown,
  field: string,
  inputId: string,
  describedBy?: string,
): FieldAria {
  const message = fieldErrorFor(error, field)
  if (!message) return describedBy ? { 'aria-describedby': describedBy } : {}
  return {
    'aria-invalid': true,
    'aria-describedby': [describedBy, errorIdFor(inputId)].filter(Boolean).join(' '),
  }
}

/**
 * td's message for one field, under that field's input. Renders nothing when
 * the error names a different field or there is no error, so a form can place
 * one under every input unconditionally.
 *
 * `role="alert"` because this is often the only feedback on the page: when
 * every field td named is bound, `unboundMessage` returns null and the panel
 * does not render at all, so without a role a screen-reader user gets silence
 * on the most common validation failure in the app. It matches ErrorPanel,
 * which carries the same role for the other half of the same rejection.
 *
 * The message is rendered verbatim — td phrases these precisely and its
 * wording is authoritative, the same rule ErrorPanel carries. Which messages
 * reach an input and which fall through to the panel is the caller's business:
 * see `unboundMessage` in api/client.ts and the `boundFields` list each form
 * hands it. This component renders one row of td's `details.fields` array —
 * the `FieldError` interface in api/types.ts describes the wire shape.
 */
export default function FieldError({ error, field, inputId }: Props) {
  const message = fieldErrorFor(error, field)
  if (!message) return null
  return (
    <p id={errorIdFor(inputId)} role="alert" className="mt-1.5 text-[11px] text-danger">
      {message}
    </p>
  )
}
