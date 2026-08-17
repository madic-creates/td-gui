import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConfirmButton from './ConfirmButton'
import { TrashIcon } from './Icon'

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

  /**
   * A trigger that sits in a row of metadata is drawn, not written. It has no
   * text left to fall back on, so the label has to become the name — a
   * caller that passes no ariaLabel gets a named control anyway, where the
   * text trigger would rightly stay unnamed and let its own words speak.
   */
  it('names an icon trigger from the label when no ariaLabel is given', () => {
    render(
      <ConfirmButton
        label="Delete comment" icon={<TrashIcon />}
        question="Delete this comment?" onConfirm={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Delete comment' })

    expect(trigger.textContent).toBe('')
    expect(trigger).toHaveAttribute('title', 'Delete comment')
  })

  // The icon is only the resting state. What it arms into is the destructive
  // half, and that stays in words.
  it('arms an icon trigger into the written question', async () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmButton
        label="Delete comment" icon={<TrashIcon />}
        question="Delete this comment?" onConfirm={onConfirm}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Delete comment' }))

    expect(screen.getByText('Delete this comment?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete comment' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  // Each ConfirmButton owns its armed state, so a list can hold two armed at
  // once. Naming only the trigger leaves the pair it swaps in ambiguous.
  it('names the armed confirm after the row it belongs to', async () => {
    const first = vi.fn()
    const second = vi.fn()
    render(
      <>
        <ConfirmButton
          label="Remove" ariaLabel="Remove td-a1b2"
          question="Remove this dependency?" onConfirm={first}
        />
        <ConfirmButton
          label="Remove" ariaLabel="Remove td-c3d4"
          question="Remove this dependency?" onConfirm={second}
        />
      </>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Remove td-a1b2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove td-c3d4' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm remove td-c3d4' }))

    expect(second).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()
  })

  it('names the armed cancel after the row it belongs to', async () => {
    render(
      <>
        <ConfirmButton
          label="Remove" ariaLabel="Remove td-a1b2"
          question="Remove this dependency?" onConfirm={vi.fn()}
        />
        <ConfirmButton
          label="Remove" ariaLabel="Remove td-c3d4"
          question="Remove this dependency?" onConfirm={vi.fn()}
        />
      </>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Remove td-a1b2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove td-c3d4' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel remove td-a1b2' }))

    expect(screen.getByRole('button', { name: 'Remove td-a1b2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm remove td-c3d4' })).toBeInTheDocument()
  })

  // ariaLabel carries user data — a board is named by whoever created it —
  // so only the verb is lowered, never the whole string.
  it('leaves the case of the name itself alone', async () => {
    render(
      <ConfirmButton
        label="Delete" ariaLabel="Delete Sprint 1"
        question="Delete this board?" onConfirm={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Delete Sprint 1' }))

    expect(screen.getByRole('button', { name: 'Confirm delete Sprint 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel delete Sprint 1' })).toBeInTheDocument()
  })

  // Callers with one control on the page pass no ariaLabel, and the visible
  // text is already an unambiguous name. Overriding it would only get in the
  // way of a user reading the screen and hearing something else.
  it('leaves the armed controls unnamed when the trigger takes no ariaLabel', async () => {
    render(<ConfirmButton label="Delete" question="Delete this issue?" onConfirm={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(screen.getByRole('button', { name: 'Confirm delete' })).not.toHaveAttribute('aria-label')
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toHaveAttribute('aria-label')
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
