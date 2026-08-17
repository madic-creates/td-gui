import { describe, expect, it } from 'vitest'
import { COL } from './columns'
import { relativeTime } from '../../lib/format'

/**
 * Width of an ISO date rendered at the row's 13px in the app's --font-sans
 * stack, measured in Chrome: 67.88px, rounded up. The stack's digits are
 * tabular, so every date relativeTime can produce is exactly this wide.
 *
 * The header label is the column's other tenant and needs less — "UPDATED ▴"
 * at 11px with tracking-wider measures 62.36px — so the date is what sizes
 * the column.
 */
const ISO_DATE_PX = 68

/** The px figure out of a Tailwind arbitrary width, e.g. `w-[74px]` -> 74. */
function widthPx(classes: string): number {
  const match = /w-\[(\d+)px\]/.exec(classes)
  if (!match) throw new Error(`no arbitrary px width in ${JSON.stringify(classes)}`)
  return Number(match[1])
}

describe('COL.updated', () => {
  it('is wide enough for the absolute date relativeTime falls back to', () => {
    const older = relativeTime('2026-07-24T09:00:00Z', new Date('2026-08-17T09:00:00Z'))
    expect(older).toBe('2026-07-24')

    expect(widthPx(COL.updated)).toBeGreaterThanOrEqual(ISO_DATE_PX)
  })

  it('keeps the value on one line even if a font stack overruns the width', () => {
    expect(COL.updated).toContain('whitespace-nowrap')
  })
})
