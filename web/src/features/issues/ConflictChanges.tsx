import { useId } from 'react'
import type { IssueStatus } from '../../api/types'
import { STATUS_LABEL } from '../../components/statusLabel'
import type { FieldChange } from './issueDiff'

/** Prose fields: their new value is in the field itself, too long to repeat. */
const prose = new Set<FieldChange['field']>(['description', 'acceptance'])

function shown(change: FieldChange, value: unknown): string {
  if (change.field === 'status') return STATUS_LABEL[value as IssueStatus] ?? String(value)
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(none)'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (value === null || value === '') return '(none)'
  return String(value)
}

/**
 * What td changed under an open editor, shown once a save was refused as a
 * conflict and the draft has been moved onto td's version.
 *
 * td's own sentence about the conflict sits in the error panel above; this is
 * the part only the GUI can say, because only it holds the draft. A field the
 * user left alone has already taken td's value, so it is listed for the
 * record. A field the user changed too keeps the draft, and says so, because
 * saving again will overwrite td's value with it.
 */
export default function ConflictChanges({ changes }: { changes: FieldChange[] }) {
  const headingId = useId()
  if (changes.length === 0) return null
  return (
    <div className="rounded-md border border-warn/40 px-3.5 py-3 text-[11px]">
      <p id={headingId} className="mb-1.5 uppercase tracking-widest text-warn">
        Changed since you opened the editor
      </p>
      <ul aria-labelledby={headingId} className="space-y-1">
        {changes.map(change => (
          <li key={change.field} className="text-ink">
            <span className="text-ink-muted">{change.label}: </span>
            {prose.has(change.field) ? 'rewritten' : shown(change, change.theirs)}
            {change.mine !== undefined && (
              <span className="text-warn">
                {' '}(your draft keeps {prose.has(change.field) ? 'its own text' : shown(change, change.mine)})
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-ink-muted">
        Fields you had not edited now show td's values. Save again to apply your draft on top.
      </p>
    </div>
  )
}
