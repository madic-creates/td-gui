import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ApiError } from '../api/client'
import FieldError, { errorIdFor, fieldAria } from './FieldError'

const rejected = new ApiError('validation_error', 'Validation failed', 400, [
  { field: 'title', rule: 'min_length', value: 'ab', expected: 15,
    message: 'title too short (2 chars, min 15)' },
])

describe('FieldError', () => {
  // td phrases its validation errors precisely and its wording is
  // authoritative. This renders one; it must never reword it.
  it("renders td's message for its field, character for character", () => {
    render(<FieldError error={rejected} field="title" inputId="new-title" />)
    expect(screen.getByText('title too short (2 chars, min 15)')).toBeInTheDocument()
  })

  // The whole point of the component. Without a role the message is a bare
  // <p>: when every field td named is bound, the panel does not render at all
  // and this line is the only feedback anywhere on the page.
  it('announces the message', () => {
    render(<FieldError error={rejected} field="title" inputId="new-title" />)
    expect(screen.getByRole('alert')).toHaveTextContent('title too short (2 chars, min 15)')
  })

  // The id is what `fieldAria` points the input's aria-describedby at, so the
  // two have to agree on it without either being told.
  it('carries the id fieldAria points at', () => {
    render(<FieldError error={rejected} field="title" inputId="new-title" />)
    expect(screen.getByRole('alert')).toHaveAttribute('id', errorIdFor('new-title'))
  })

  // The forms render one of these under every field, so the common case is an
  // error that names a different field — or no error at all.
  it('renders nothing when the error names another field', () => {
    const { container } = render(
      <FieldError error={rejected} field="description" inputId="new-description" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing without an error', () => {
    const { container } = render(<FieldError error={null} field="title" inputId="new-title" />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('fieldAria', () => {
  it('marks the input invalid and points it at the message', () => {
    expect(fieldAria(rejected, 'title', 'new-title')).toEqual({
      'aria-invalid': true,
      'aria-describedby': errorIdFor('new-title'),
    })
  })

  // A form spreads this onto every input unconditionally, so the quiet case
  // has to leave the input alone rather than mark it invalid.
  it('says nothing when the error names another field', () => {
    expect(fieldAria(rejected, 'description', 'new-description')).toEqual({})
  })

  it('says nothing without an error', () => {
    expect(fieldAria(null, 'title', 'new-title')).toEqual({})
  })

  // Composition, not replacement. `description`, `acceptance` and the comment
  // box already describe themselves with a MarkdownHint, and IssueCombobox
  // with its cap notice — overwriting aria-describedby would trade one
  // silence for another.
  it('appends the message to a description the input already had', () => {
    expect(fieldAria(rejected, 'title', 'new-title', 'new-title-hint')).toEqual({
      'aria-invalid': true,
      'aria-describedby': `new-title-hint ${errorIdFor('new-title')}`,
    })
  })

  it('keeps that description when there is no error', () => {
    expect(fieldAria(null, 'title', 'new-title', 'new-title-hint')).toEqual({
      'aria-describedby': 'new-title-hint',
    })
  })
})
