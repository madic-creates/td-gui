import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import EpicProgress from './EpicProgress'
import type { Rollup } from './epicRollup'

const show = (rollup: Rollup) => render(<EpicProgress rollup={rollup} />)

describe('EpicProgress', () => {
  it('draws one segment per status, sized by its share of the total', () => {
    show({
      total: 4,
      done: 1,
      buckets: [
        { status: 'open', count: 2 },
        { status: 'in_review', count: 1 },
        { status: 'closed', count: 1 },
      ],
    })

    expect(screen.getByTestId('segment-open')).toHaveStyle({ width: '50%' })
    expect(screen.getByTestId('segment-in_review')).toHaveStyle({ width: '25%' })
    expect(screen.getByTestId('segment-closed')).toHaveStyle({ width: '25%' })
  })

  it('reports the closed count over the total', () => {
    show({ total: 3, done: 2, buckets: [
      { status: 'open', count: 1 }, { status: 'closed', count: 2 },
    ] })

    expect(screen.getByText('2/3')).toBeInTheDocument()
  })

  // The one thing a single-tone bar could not say. With most epics holding one
  // task, "1 In review" is the answer the page was opened for.
  it('names each status in the legend, in td-gui\'s own status wording', () => {
    show({ total: 2, done: 0, buckets: [
      { status: 'in_progress', count: 1 }, { status: 'in_review', count: 1 },
    ] })

    expect(screen.getByText(/In progress 1/)).toBeInTheDocument()
    expect(screen.getByText(/In review 1/)).toBeInTheDocument()
  })

  // A status td grows later still has to draw and still has to be named. It
  // has no reader-facing wording here, so the wire spelling is the honest one.
  it('falls back to the raw status for one it has no wording for', () => {
    show({ total: 1, done: 0, buckets: [{ status: 'deferred', count: 1 }] })

    expect(screen.getByTestId('segment-deferred')).toHaveStyle({ width: '100%' })
    expect(screen.getByText(/deferred 1/)).toBeInTheDocument()
  })

  // The majority case, and not a failure: an epic nobody has decomposed yet
  // must not be drawn as an epic whose work has stalled at zero.
  it('says "no tasks" rather than drawing an empty bar', () => {
    const { container } = show({ total: 0, done: 0, buckets: [] })

    expect(screen.getByText('no tasks')).toBeInTheDocument()
    expect(screen.queryByText('0/0')).not.toBeInTheDocument()
    expect(container.querySelectorAll('[data-testid^="segment-"]')).toHaveLength(0)
  })
})
