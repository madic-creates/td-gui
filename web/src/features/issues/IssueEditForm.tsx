import { useState } from 'react'
import { ApiError, fieldErrorFor } from '../../api/client'
import { useUpdateIssue } from '../../api/mutations'
import type { Issue, IssueType, Priority } from '../../api/types'
import ErrorPanel from '../../components/ErrorPanel'
import LabelInput from './LabelInput'
import { diffIssue, draftFrom, isEmptyPatch, type IssueDraft } from './issueDiff'

const types: IssueType[] = ['task', 'feature', 'bug', 'chore', 'epic']
const priorities: Priority[] = ['P0', 'P1', 'P2', 'P3', 'P4']

const fieldClass = 'w-full rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink'
const legendClass = 'mb-1.5 block text-[11px] uppercase tracking-widest text-ink-muted'

interface Props {
  issue: Issue
  onDone: () => void
}

/**
 * No client-side bounds anywhere: title length and the points enum are
 * per-project td config, so the server validates and this renders its answer.
 * The dates use type="date" because it emits td's YYYY-MM-DD exactly.
 */
export default function IssueEditForm({ issue, onDone }: Props) {
  // Both seeded once, deliberately. useLiveUpdates invalidates the detail
  // query on every SSE event; re-syncing the draft would wipe whatever is
  // being typed. `original` is the issue as it was at that same moment, and
  // the diff is against it rather than against the live prop: another
  // session's background change to a field the user never touched would
  // otherwise read as an edit and get overwritten with the draft's stale copy.
  const [original] = useState(issue)
  const [draft, setDraft] = useState<IssueDraft>(() => draftFrom(issue))
  const update = useUpdateIssue(issue.id)

  function set<K extends keyof IssueDraft>(key: K, value: IssueDraft[K]) {
    setDraft(current => ({ ...current, [key]: value }))
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const patch = diffIssue(original, draft)
    // Nothing changed — close rather than issue an empty PATCH.
    if (isEmptyPatch(patch)) {
      onDone()
      return
    }
    update.mutate(patch, { onSuccess: onDone })
  }

  const panelError = panelMessage(update.error)

  return (
    <form className="mt-4 space-y-4 border-t border-line-subtle pt-4" onSubmit={submit}>
      <div>
        <label htmlFor="edit-title" className={legendClass}>Title</label>
        <input id="edit-title" value={draft.title}
          onChange={e => set('title', e.target.value)} className={fieldClass} />
        <FieldError error={update.error} field="title" />
      </div>

      <div>
        <label htmlFor="edit-description" className={legendClass}>Description</label>
        <textarea id="edit-description" rows={6} value={draft.description}
          onChange={e => set('description', e.target.value)} className={fieldClass} />
        <FieldError error={update.error} field="description" />
      </div>

      <div>
        <label htmlFor="edit-acceptance" className={legendClass}>Acceptance criteria</label>
        <textarea id="edit-acceptance" rows={4} value={draft.acceptance}
          onChange={e => set('acceptance', e.target.value)} className={fieldClass} />
        <FieldError error={update.error} field="acceptance" />
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div>
          <label htmlFor="edit-type" className={legendClass}>Type</label>
          <select id="edit-type" value={draft.type}
            onChange={e => set('type', e.target.value as IssueType)} className={fieldClass}>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <FieldError error={update.error} field="type" />
        </div>
        <div>
          <label htmlFor="edit-priority" className={legendClass}>Priority</label>
          <select id="edit-priority" value={draft.priority}
            onChange={e => set('priority', e.target.value as Priority)} className={fieldClass}>
            {priorities.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <FieldError error={update.error} field="priority" />
        </div>
        <div>
          {/* No min or max: the accepted values are td config, and it names
              them in the error when a value is rejected. */}
          <label htmlFor="edit-points" className={legendClass}>Points</label>
          <input id="edit-points" type="number" value={draft.points ?? ''}
            onChange={e => set('points', e.target.value === '' ? null : Number(e.target.value))}
            className={fieldClass} />
          <FieldError error={update.error} field="points" />
        </div>
        <div>
          <label htmlFor="edit-sprint" className={legendClass}>Sprint</label>
          <input id="edit-sprint" value={draft.sprint}
            onChange={e => set('sprint', e.target.value)} className={fieldClass} />
          <FieldError error={update.error} field="sprint" />
        </div>
      </div>

      <div>
        <LabelInput value={draft.labels} onChange={labels => set('labels', labels)} />
        <FieldError error={update.error} field="labels" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="edit-parent" className={legendClass}>Parent</label>
          <input id="edit-parent" value={draft.parent_id} placeholder="td-…"
            onChange={e => set('parent_id', e.target.value)} className={fieldClass} />
          <FieldError error={update.error} field="parent_id" />
        </div>
        <div>
          <label htmlFor="edit-due" className={legendClass}>Due date</label>
          <input id="edit-due" type="date" value={draft.due_date}
            onChange={e => set('due_date', e.target.value)} className={fieldClass} />
          <FieldError error={update.error} field="due_date" />
        </div>
        <div>
          <label htmlFor="edit-defer" className={legendClass}>Defer until</label>
          <input id="edit-defer" type="date" value={draft.defer_until}
            onChange={e => set('defer_until', e.target.value)} className={fieldClass} />
          <FieldError error={update.error} field="defer_until" />
        </div>
      </div>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={draft.minor}
          onChange={e => set('minor', e.target.checked)} />
        <span>Minor — self-reviewable</span>
      </label>

      <div className="flex gap-1.5">
        <button type="submit" disabled={update.isPending}
          className="rounded-sm border border-accent px-3 py-1 text-[11px] text-accent disabled:opacity-40">
          Save changes
        </button>
        <button type="button" onClick={onDone}
          className="rounded-sm border border-line px-3 py-1 text-[11px] text-ink-muted">
          Cancel
        </button>
      </div>

      {panelError && <ErrorPanel label="Update rejected" message={panelError} />}
    </form>
  )
}

/**
 * Every field with a <FieldError> of its own above. `minor` is deliberately
 * absent — it is the one editable field without one — so an error naming it,
 * or naming anything td renames later, falls through to the panel instead of
 * rendering nowhere.
 */
const boundFields = [
  'title', 'description', 'acceptance', 'type', 'priority', 'points', 'sprint',
  'labels', 'parent_id', 'due_date', 'defer_until',
]

/**
 * What the panel shows, if anything. The default is to show the error — the
 * panel stays silent only when every field error it carries is already
 * rendered against its own input, where repeating it would be noise.
 *
 * The three cases that would otherwise vanish: a non-ApiError (fetch rejects
 * with a TypeError on a dropped connection and nothing catches it), an
 * ApiError with no fields (td's JSON type errors), and field errors naming a
 * field this form does not bind. All are rendered verbatim.
 */
function panelMessage(error: unknown): string | null {
  if (!error) return null
  if (!(error instanceof ApiError)) return String(error)
  if (error.fields.length === 0) return error.message
  const unbound = error.fields.filter(f => !boundFields.includes(f.field))
  if (unbound.length === 0) return null
  return unbound.map(f => f.message).join(' — ')
}

function FieldError({ error, field }: { error: unknown; field: string }) {
  const message = fieldErrorFor(error, field)
  if (!message) return null
  return <p className="mt-1.5 text-[11px] text-danger">{message}</p>
}
