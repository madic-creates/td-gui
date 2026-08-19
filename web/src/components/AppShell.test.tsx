import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import AppShell from './AppShell'

const about = {
  project: '/home/you/my-project',
  td_gui: 'v1.2.3',
  td: 'v0.57.0',
  td_path: '/home/you/go/bin/td',
  go: 'go1.24.0',
  platform: 'linux/amd64',
  source: 'https://github.com/madic-creates/td-gui',
  license: 'Apache-2.0',
  backend: { url: 'http://127.0.0.1:41234', owned: true },
}

const server = setupServer(
  http.get('/gui/about', () => HttpResponse.json({ ok: true, data: about })),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

beforeEach(() => { document.title = 'td-gui' })

function renderShell(connected: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AppShell connected={connected}><p>route content</p></AppShell>
      </MemoryRouter>
    </QueryClientProvider>,
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

  it('offers the prose mode toggle in the header', () => {
    renderShell(true)
    expect(screen.getByRole('button', { name: /^Text: / })).toBeInTheDocument()
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

  it('links to the about page from an icon-only control', async () => {
    renderShell(true)

    const link = await screen.findByRole('link', { name: 'About' })

    expect(link).toHaveAttribute('href', '/about')
    expect(link).toHaveAttribute('title', 'About')
    // The glyph is hidden, so the label is the whole of the accessible name —
    // a visible one would announce the control twice, once badly.
    expect(link.textContent).toBe('')
  })

  /**
   * td-gui is per-project and several are routinely open at once. Without
   * this the header says `td-gui` in every one of them, and telling two
   * windows apart means clicking into one and recognising the issues.
   */
  it('names the project in the header', async () => {
    renderShell(true)
    expect(await screen.findByText('my-project')).toBeInTheDocument()
  })

  // The tab strip is where windows are actually told apart, so this is the
  // larger half of the same fix.
  it('puts the project in the document title', async () => {
    renderShell(true)
    await screen.findByText('my-project')
    expect(document.title).toBe('td-gui — my-project')
  })

  // One word, and a skeleton for one word is noisier than its absence. The
  // header must still be complete and the title must not say "undefined".
  it('renders the header before the project name arrives', () => {
    renderShell(true)
    expect(screen.getByText('td-gui')).toBeInTheDocument()
    expect(document.title).toBe('td-gui')
  })

  // Absence of a name is not a name. A failed /gui/about leaves the header
  // exactly as it was rather than showing an error the user cannot act on.
  it('leaves the header alone when the about route fails', async () => {
    server.use(http.get('/gui/about', () => new HttpResponse(null, { status: 500 })))
    renderShell(true)

    expect(await screen.findByRole('link', { name: 'About' })).toBeInTheDocument()
    expect(document.title).toBe('td-gui')
    expect(screen.queryByText('my-project')).not.toBeInTheDocument()
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
