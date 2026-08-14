import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatusTag from './StatusTag'

describe('StatusTag', () => {
  it("renders td's raw status token", () => {
    render(<StatusTag status="in_progress" />)
    expect(screen.getByText('in_progress')).toBeInTheDocument()
  })

  it('renders an unknown status verbatim instead of throwing', () => {
    render(<StatusTag status="archived_by_future_td" />)
    expect(screen.getByText('archived_by_future_td')).toBeInTheDocument()
  })
})
