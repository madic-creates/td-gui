import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import AboutPage from './AboutPage'
import type { About } from '../../api/types'

const about: About = {
  project: '/home/you/proj',
  td_gui: 'v1.2.3',
  td: 'v0.57.0',
  td_path: '/home/you/go/bin/td',
  go: 'go1.24.0',
  platform: 'linux/amd64',
  source: 'https://github.com/madic-creates/td-gui',
  license: 'Apache-2.0',
  backend: { url: 'http://127.0.0.1:41234', owned: true },
}

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  Reflect.deleteProperty(navigator, 'clipboard')
})
afterAll(() => server.close())

function renderAbout(data: About = about) {
  server.use(http.get('/gui/about', () => HttpResponse.json({ ok: true, data })))
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><AboutPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AboutPage', () => {
  it('reports the project, both versions and the platform', async () => {
    renderAbout()

    expect(await screen.findByText('/home/you/proj')).toBeInTheDocument()
    expect(screen.getByText('v1.2.3')).toBeInTheDocument()
    expect(screen.getByText('v0.57.0')).toBeInTheDocument()
    expect(screen.getByText('/home/you/go/bin/td')).toBeInTheDocument()
    expect(screen.getByText('go1.24.0')).toBeInTheDocument()
    expect(screen.getByText('linux/amd64')).toBeInTheDocument()
    expect(screen.getByText('Apache-2.0')).toBeInTheDocument()
  })

  // owned is a boolean on the wire and a sentence on screen — "true" would
  // tell a reader filing a bug report nothing about what it means.
  it('says the backend was started by td-gui when it owns it', async () => {
    renderAbout()
    expect(await screen.findByText(/started by td-gui/)).toBeInTheDocument()
  })

  it('says the backend was already running when it does not own it', async () => {
    renderAbout({ ...about, backend: { url: 'http://127.0.0.1:2', owned: false } })
    expect(await screen.findByText(/existing instance/)).toBeInTheDocument()
  })

  // A local page linking out to the public repo: the tab it opens must not
  // keep a handle on this one.
  it('links to the source repository safely', async () => {
    renderAbout()

    const link = await screen.findByRole('link', { name: /github\.com\/madic-creates\/td-gui/ })

    expect(link).toHaveAttribute('href', 'https://github.com/madic-creates/td-gui')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
  })

  // The point of the page for a bug report: one click, everything a maintainer
  // asks for, already formatted.
  it('copies every field as one block for a bug report', async () => {
    const user = userEvent.setup()
    const written: string[] = []
    renderAbout()
    await screen.findByText('/home/you/proj')
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (v: string) => void written.push(v) },
      configurable: true,
    })

    await user.click(screen.getByRole('button', { name: 'Copy diagnostics' }))

    expect(written).toHaveLength(1)
    for (const fragment of [
      '/home/you/proj', 'v1.2.3', 'v0.57.0', '/home/you/go/bin/td',
      'go1.24.0', 'linux/amd64',
    ]) {
      expect(written[0]).toContain(fragment)
    }
  })

  // The token is never in the response, so it cannot reach the clipboard —
  // but the diagnostics block is the one place in the UI whose whole job is
  // to be pasted somewhere public, so the assertion lives here too.
  it('never puts a token in the diagnostics block', async () => {
    const user = userEvent.setup()
    const written: string[] = []
    renderAbout()
    await screen.findByText('/home/you/proj')
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (v: string) => void written.push(v) },
      configurable: true,
    })

    await user.click(screen.getByRole('button', { name: 'Copy diagnostics' }))

    expect(written[0].toLowerCase()).not.toContain('token')
  })

  it('shows the server error when the route fails', async () => {
    server.use(http.get('/gui/about', () => HttpResponse.json(
      { ok: false, error: { code: 'internal', message: 'about is unavailable' } },
      { status: 500 },
    )))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><AboutPage /></MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText(/about is unavailable/)).toBeInTheDocument()
  })
})
