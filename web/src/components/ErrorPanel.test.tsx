import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import ErrorPanel from './ErrorPanel'

describe('ErrorPanel', () => {
  // td phrases validation and policy errors precisely. The panel frames the
  // message; it must never reword, truncate or prettify it.
  it("renders td's message character for character", () => {
    const message = 'title too short (2 chars, min 15)'
    render(<ErrorPanel message={message} />)
    expect(screen.getByText(message)).toBeInTheDocument()
  })

  it('exposes itself as an alert', () => {
    render(<ErrorPanel message="database is locked" />)
    expect(screen.getByRole('alert')).toHaveTextContent('database is locked')
  })

  it('shows a default label and accepts an override', () => {
    const { rerender } = render(<ErrorPanel message="boom" />)
    expect(screen.getByText('Request failed')).toBeInTheDocument()

    rerender(<ErrorPanel message="boom" label="Transition rejected" />)
    expect(screen.getByText('Transition rejected')).toBeInTheDocument()
  })
})
