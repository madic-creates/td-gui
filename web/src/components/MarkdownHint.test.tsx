import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import MarkdownHint from './MarkdownHint'

describe('MarkdownHint', () => {
  it('names the flavour rather than just saying "Markdown"', () => {
    render(<MarkdownHint id="description-hint" />)

    expect(screen.getByText(/GitHub Flavored Markdown/)).toBeInTheDocument()
  })

  it('links the GFM spec, opened safely', () => {
    render(<MarkdownHint id="description-hint" />)

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://github.github.com/gfm/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  it('carries the id its field points at with aria-describedby', () => {
    const { container } = render(<MarkdownHint id="acceptance-hint" />)

    expect(container.querySelector('#acceptance-hint')).not.toBeNull()
  })
})
