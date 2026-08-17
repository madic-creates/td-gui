import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ApiError } from '../api/client'
import FieldError from './FieldError'

const rejected = new ApiError('validation_error', 'Validation failed', 400, [
  { field: 'title', rule: 'min_length', value: 'ab', expected: 15,
    message: 'title too short (2 chars, min 15)' },
])

describe('FieldError', () => {
  // td phrases its validation errors precisely and its wording is
  // authoritative. This renders one; it must never reword it.
  it("renders td's message for its field, character for character", () => {
    render(<FieldError error={rejected} field="title" />)
    expect(screen.getByText('title too short (2 chars, min 15)')).toBeInTheDocument()
  })

  // The forms render one of these under every field, so the common case is an
  // error that names a different field — or no error at all.
  it('renders nothing when the error names another field', () => {
    const { container } = render(<FieldError error={rejected} field="description" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing without an error', () => {
    const { container } = render(<FieldError error={null} field="title" />)
    expect(container).toBeEmptyDOMElement()
  })
})
