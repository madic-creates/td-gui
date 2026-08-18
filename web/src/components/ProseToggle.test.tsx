import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProseToggle from './ProseToggle'
import { PROSE_STORAGE_KEY, getMode, setMode } from '../lib/prose'

beforeEach(() => {
  setMode('markdown')
  localStorage.clear()
})

afterEach(() => {
  setMode('markdown')
})

describe('ProseToggle', () => {
  it('starts on markdown and names both the current and the next mode', () => {
    render(<ProseToggle />)
    expect(
      screen.getByRole('button', { name: 'Text: markdown. Switch to raw.' }),
    ).toBeInTheDocument()
  })

  /* jsdom applies no text-transform, so the class is the only reachable
     evidence that the label is not written in lower case in the header. */
  it('writes its label with a capital, like the other header controls', () => {
    render(<ProseToggle />)
    expect(screen.getByRole('button').className).toContain('capitalize')
  })

  it('flips the mode on click and back again', async () => {
    const user = userEvent.setup()
    render(<ProseToggle />)

    await user.click(screen.getByRole('button'))
    expect(getMode()).toBe('raw')
    expect(screen.getByRole('button', { name: 'Text: raw. Switch to markdown.' })).toBeInTheDocument()

    await user.click(screen.getByRole('button'))
    expect(getMode()).toBe('markdown')
  })

  it('persists the choice, so a reload keeps it', async () => {
    const user = userEvent.setup()
    render(<ProseToggle />)

    await user.click(screen.getByRole('button'))

    expect(localStorage.getItem(PROSE_STORAGE_KEY)).toBe('raw')
  })

  /* The button renders the store, it does not own a copy of it: a mode set
     anywhere else has to show up here too. */
  it('shows the mode the store is already on', () => {
    setMode('raw')
    render(<ProseToggle />)

    expect(
      screen.getByRole('button', { name: 'Text: raw. Switch to markdown.' }),
    ).toBeInTheDocument()
  })
})
