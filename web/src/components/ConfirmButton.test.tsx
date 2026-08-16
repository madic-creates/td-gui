import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConfirmButton from './ConfirmButton'

describe('ConfirmButton', () => {
  it('does not fire on the first click', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmButton label="Delete" question="Delete this issue?" onConfirm={onConfirm} />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText('Delete this issue?')).toBeInTheDocument()
  })

  it('fires once the confirm is clicked', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmButton label="Delete" question="Delete this issue?" onConfirm={onConfirm} />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

    expect(onConfirm).toHaveBeenCalledOnce()
  })

  // A list of rows repeats the same control, so the caller needs a way to say
  // which row this one belongs to without spelling it out on screen.
  it('lets the caller name the trigger beyond its visible label', async () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmButton
        label="Delete"
        ariaLabel="Delete Sprint 1"
        question="Delete this board?"
        onConfirm={onConfirm}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Delete Sprint 1' })
    expect(trigger.textContent).toBe('Delete')
  })

  it('restores the trigger on cancel without firing', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmButton label="Delete" question="Delete this issue?" onConfirm={onConfirm} />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.queryByText('Delete this issue?')).not.toBeInTheDocument()
  })
})
