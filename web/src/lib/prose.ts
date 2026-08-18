/**
 * How long text is displayed: as rendered Markdown, or as the source td
 * actually stored.
 *
 * `raw` is not a fallback for a broken renderer, it is a second reading of the
 * same text: what the author typed, with their line breaks and their column
 * alignment intact. It answers what `td show` answers.
 */
export type ProseMode = 'markdown' | 'raw'

export const PROSE_STORAGE_KEY = 'td-gui.prose'

const MODES: ProseMode[] = ['markdown', 'raw']

/** Two states, so the next one is simply the other one. */
export function otherMode(mode: ProseMode): ProseMode {
  return mode === 'markdown' ? 'raw' : 'markdown'
}

function isMode(value: unknown): value is ProseMode {
  return MODES.includes(value as ProseMode)
}

/**
 * Reading localStorage throws outright in some sandboxed contexts, so a
 * missing, unreadable or unrecognised value all degrade to `markdown`, which
 * is what the app did before this mode existed.
 */
export function readStoredMode(): ProseMode {
  try {
    const stored = localStorage.getItem(PROSE_STORAGE_KEY)
    return isMode(stored) ? stored : 'markdown'
  } catch {
    return 'markdown'
  }
}

export function storeMode(mode: ProseMode): void {
  try {
    localStorage.setItem(PROSE_STORAGE_KEY, mode)
  } catch {
    /* A choice that survives only this tab still beats a crash. */
  }
}

/*
 * `theme.ts` needs no store: it writes `<html data-theme>` and the stylesheet
 * does the rest. React rendering has no such side channel, and the header
 * button and every mounted Markdown have to agree on one value, so the module
 * holds it and hands it out through useSyncExternalStore. A Context would have
 * to be threaded through the tree and into every test that renders prose on
 * its own.
 */
let current = readStoredMode()

const listeners = new Set<() => void>()

export function getMode(): ProseMode {
  return current
}

export function setMode(mode: ProseMode): void {
  if (mode === current) return
  current = mode
  storeMode(mode)
  listeners.forEach((listener) => listener())
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
