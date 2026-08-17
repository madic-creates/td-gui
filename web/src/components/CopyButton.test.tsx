import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CopyButton from './CopyButton'

/**
 * Settles the click handler's own promise. The timer tests drive the button
 * with fireEvent rather than userEvent: user-event awaits real time between
 * its steps, which never elapses once the clock is faked, so the click never
 * returns. fireEvent dispatches synchronously, leaving only the await inside
 * the handler — one microtask turn, which is what this flushes.
 */
const flush = () => act(async () => {})

/**
 * jsdom has no clipboard, and user-event installs a stub of its own during
 * `setup()`. Both are why every test here defines `navigator.clipboard`
 * itself, and does so *after* the user instance exists — otherwise the stub
 * lands on top of the spy and the assertions watch the wrong object.
 */
function stubClipboard(writeText: (value: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
  vi.useRealTimers()
})

describe('CopyButton', () => {
  it('writes the value to the clipboard and says it did', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)
    render(<CopyButton value="td-6a0883" label="Copy issue id" />)

    await user.click(screen.getByRole('button', { name: 'Copy issue id' }))

    expect(writeText).toHaveBeenCalledExactlyOnceWith('td-6a0883')
    expect(await screen.findByText('copied')).toBeInTheDocument()
  })

  /**
   * The whole point of the outcome line. writeText rejects when the document
   * is not focused or the permission was denied, and a swallowed rejection is
   * indistinguishable from a copy that worked — right up until the paste.
   */
  it('reports a rejected write instead of claiming success', async () => {
    const user = userEvent.setup()
    stubClipboard(vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')))
    render(<CopyButton value="td-6a0883" label="Copy issue id" />)

    await user.click(screen.getByRole('button', { name: 'Copy issue id' }))

    expect(await screen.findByText('copy failed')).toBeInTheDocument()
    expect(screen.queryByText('copied')).not.toBeInTheDocument()
  })

  // No clipboard object at all: what a page served over plain http gets.
  it('reports a missing clipboard API rather than throwing', async () => {
    const user = userEvent.setup()
    Reflect.deleteProperty(navigator, 'clipboard')
    render(<CopyButton value="td-6a0883" label="Copy issue id" />)

    await user.click(screen.getByRole('button', { name: 'Copy issue id' }))

    expect(await screen.findByText('copy failed')).toBeInTheDocument()
  })

  it('returns to idle once the confirmation has been read', async () => {
    vi.useFakeTimers()
    stubClipboard(vi.fn().mockResolvedValue(undefined))
    render(<CopyButton value="td-6a0883" label="Copy issue id" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy issue id' }))
    await flush()
    expect(screen.getByText('copied')).toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync(2000))

    expect(screen.queryByText('copied')).not.toBeInTheDocument()
    // The live region stays mounted while empty, so the next copy is a change
    // to an existing region rather than a region arriving pre-filled.
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  /**
   * A second click a moment after the first would otherwise inherit what was
   * left of the first click's window and clear the confirmation almost at
   * once — the timer has to restart, not carry on.
   */
  it('restarts the window on a second copy', async () => {
    vi.useFakeTimers()
    stubClipboard(vi.fn().mockResolvedValue(undefined))
    render(<CopyButton value="td-6a0883" label="Copy issue id" />)

    const button = screen.getByRole('button', { name: 'Copy issue id' })
    fireEvent.click(button)
    await flush()
    await act(() => vi.advanceTimersByTimeAsync(1500))
    fireEvent.click(button)
    await flush()
    await act(() => vi.advanceTimersByTimeAsync(1500))

    expect(screen.getByText('copied')).toBeInTheDocument()
  })
})
