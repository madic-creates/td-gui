import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ThemeToggle from './ThemeToggle'
import { THEME_STORAGE_KEY } from '../lib/theme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ThemeToggle', () => {
  it('starts on auto and names both the current and the next theme', () => {
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: 'Theme: auto. Switch to light.' })).toBeInTheDocument()
  })

  /* jsdom applies no text-transform, so the class is the only reachable
     evidence that the label is not written in lower case in the header. */
  it('writes its label with a capital, like the other header controls', () => {
    render(<ThemeToggle />)
    expect(screen.getByRole('button').className).toContain('capitalize')
  })

  it('cycles auto → light → dark → auto on click', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)

    await user.click(screen.getByRole('button'))
    expect(screen.getByRole('button', { name: 'Theme: light. Switch to dark.' })).toBeInTheDocument()

    await user.click(screen.getByRole('button'))
    expect(screen.getByRole('button', { name: 'Theme: dark. Switch to auto.' })).toBeInTheDocument()

    await user.click(screen.getByRole('button'))
    expect(screen.getByRole('button', { name: 'Theme: auto. Switch to light.' })).toBeInTheDocument()
  })

  it('applies the resolved theme to the document and persists the preference', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)

    await user.click(screen.getByRole('button'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')

    await user.click(screen.getByRole('button'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('restores the stored preference on mount', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: 'Theme: dark. Switch to auto.' })).toBeInTheDocument()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})
