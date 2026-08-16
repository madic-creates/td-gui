import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import AppShell from './AppShell'

function renderShell(connected: boolean) {
  return render(
    <MemoryRouter>
      <AppShell connected={connected}><p>route content</p></AppShell>
    </MemoryRouter>,
  )
}

describe('AppShell', () => {
  it('renders the brand, the New issue action and its children', () => {
    renderShell(true)
    expect(screen.getByText('td-gui')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New issue' })).toHaveAttribute('href', '/new')
    expect(screen.getByText('route content')).toBeInTheDocument()
  })

  it('offers the theme toggle in the header', () => {
    renderShell(true)
    expect(screen.getByRole('button', { name: /^Theme: / })).toBeInTheDocument()
  })

  it('reports the connected state in the header', () => {
    renderShell(true)
    expect(screen.getByText('connected')).toBeInTheDocument()
    expect(screen.queryByText(/may be out of date/)).not.toBeInTheDocument()
  })

  it('warns about stale data when disconnected', () => {
    renderShell(false)
    expect(screen.getByText('disconnected')).toBeInTheDocument()
    expect(
      screen.getByText('Backend disconnected — the data shown may be out of date.'),
    ).toBeInTheDocument()
  })

  it('links to the boards page', () => {
    renderShell(true)
    expect(screen.getByRole('link', { name: 'Boards' })).toHaveAttribute('href', '/boards')
  })

  // The rule under the header has to reach both window edges while the logo
  // lines up with the body below it, so <header> stays full-bleed and only an
  // inner wrapper is capped. A cap on <header> itself would stop the border
  // short and turn the header into a boxed panel.
  it('caps the header contents in a wrapper rather than capping the header', () => {
    renderShell(true)
    const header = screen.getByRole('banner')
    const brand = screen.getByText('td-gui')

    expect(header).toContainElement(brand)
    expect(brand.parentElement).not.toBe(header)
    expect(brand.parentElement?.parentElement).toBe(header)
  })

  // A regression guard rather than a red test: the route content is already in
  // the main landmark, and wrapping <main> in anything that broke that would
  // cost every view its landmark.
  it('keeps the route content inside the main landmark', () => {
    renderShell(true)
    expect(screen.getByRole('main')).toContainElement(screen.getByText('route content'))
  })
})
