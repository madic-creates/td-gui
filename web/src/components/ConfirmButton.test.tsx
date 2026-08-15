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
