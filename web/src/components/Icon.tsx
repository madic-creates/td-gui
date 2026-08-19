import type { ReactNode } from 'react'

/**
 * The one icon frame. Every icon in the app is a 16-box line drawing in
 * currentColor, so it inherits whatever ink the row around it is written in
 * and needs no per-theme variant.
 *
 * Always `aria-hidden`: an icon here is either inside a button whose
 * `aria-label` already names it, or beside text that says the same thing.
 * There is no case where the shape itself should be announced, and a frame
 * that could not hide it would invite one.
 *
 * Exported for ThemeToggle, which picks its paths from a record keyed on the
 * current preference and so cannot be one of the fixed icons below.
 */
export default function Icon({ children, className = 'h-3 w-3' }: {
  children: ReactNode
  className?: string
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

/** Two sheets, the back one drawn as the L its front neighbour leaves visible. */
export function CopyIcon() {
  return (
    <Icon>
      <rect x="6" y="6" width="8" height="8" rx="1.5" />
      <path d="M10 6V3.5A1 1 0 0 0 9 2.5H3.5a1 1 0 0 0-1 1V9a1 1 0 0 0 1 1H6" />
    </Icon>
  )
}

/** Lid, handle, body, and the two ribs that keep it from reading as a cup. */
export function TrashIcon() {
  return (
    <Icon>
      <path d="M2.5 4.5h11" />
      <path d="M6.5 4.5V3.25a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1V4.5" />
      <path d="M4.25 4.5l.55 8.1a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9l.55-8.1" />
      <path d="M6.75 7v3.75M9.25 7v3.75" />
    </Icon>
  )
}

/**
 * A pin under a stroke. The slash is the whole message — a bare pin is the
 * state the row is already in, and only the cancelling line says the button
 * undoes it.
 *
 * Head and stem, not a drawn thumbtack: the icon renders at 12px, and a
 * tack's flange and shoulders plus a diagonal across them came out as a blot
 * at that size. Two shapes leave the slash somewhere to be seen.
 */
export function UnpinIcon() {
  return (
    <Icon>
      <circle cx="8" cy="6" r="2.75" />
      <path d="M8 8.75v4.75" />
      <path d="M3 3l10 10" />
    </Icon>
  )
}

/**
 * Circle, dot, stem — an ⓘ rather than a `?`.
 *
 * A question mark promises help or documentation in nearly every application
 * that has one, and the About page is neither. It also draws worse at this
 * size: the bowl and tail of a `?` close up into a blot at 12px, while three
 * separated shapes stay legible.
 */
export function AboutIcon() {
  return (
    <Icon>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.25v3.75" />
      <path d="M8 5.05v.01" />
    </Icon>
  )
}

export function ArrowUpIcon() {
  return <Icon><path d="M8 13V3.5M4.25 7.25L8 3.5l3.75 3.75" /></Icon>
}

export function ArrowDownIcon() {
  return <Icon><path d="M8 3v9.5M4.25 8.75L8 12.5l3.75-3.75" /></Icon>
}
