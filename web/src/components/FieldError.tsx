import { fieldErrorFor } from '../api/client'

interface Props {
  /** A rejected mutation's error. Anything else renders nothing. */
  error: unknown
  /** td's own name for the field, as it appears in `details.fields`. */
  field: string
}

/**
 * td's message for one field, under that field's input. Renders nothing when
 * the error names a different field or there is no error, so a form can place
 * one under every input unconditionally.
 *
 * The message is rendered verbatim — td phrases these precisely and its
 * wording is authoritative, the same rule ErrorPanel carries. Which messages
 * reach an input and which fall through to the panel is the caller's business:
 * see `unboundMessage` in api/client.ts and the `boundFields` list each form
 * hands it. This component renders one row of td's `details.fields` array —
 * the `FieldError` interface in api/types.ts describes the wire shape.
 */
export default function FieldError({ error, field }: Props) {
  const message = fieldErrorFor(error, field)
  if (!message) return null
  return <p className="mt-1.5 text-[11px] text-danger">{message}</p>
}
