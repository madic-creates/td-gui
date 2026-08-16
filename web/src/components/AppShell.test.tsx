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

  // The shell imposes no width of its own: a 1440px cap lived here briefly and
  // was taken back out, because it squeezed the detail view's prose while a
  // third of the window sat empty and it clipped the toolbars inside <main>.
  // Asserting on the tree rather than on classes — the brand sits directly in
  // the header, with no centring wrapper between them.
  it('puts the header contents straight in the header, with no capped wrapper', () => {
    renderShell(true)
    expect(screen.getByText('td-gui').parentElement).toBe(screen.getByRole('banner'))
  })

  // A regression guard rather than a red test: the route content is already in
  // the main landmark, and wrapping <main> in anything that broke that would
  // cost every view its landmark.
  it('keeps the route content inside the main landmark', () => {
    renderShell(true)
    expect(screen.getByRole('main')).toContainElement(screen.getByText('route content'))
  })
})
