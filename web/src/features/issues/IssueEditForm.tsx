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
  // Seeded once, deliberately. useLiveUpdates invalidates the detail query on
  // every SSE event; re-syncing the draft would wipe whatever is being typed.
  const [draft, setDraft] = useState<IssueDraft>(() => draftFrom(issue))
  const update = useUpdateIssue(issue.id)

  function set<K extends keyof IssueDraft>(key: K, value: IssueDraft[K]) {
    setDraft(current => ({ ...current, [key]: value }))
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const patch = diffIssue(issue, draft)
    // Nothing changed — close rather than issue an empty PATCH.
    if (isEmptyPatch(patch)) {
      onDone()
      return
    }
    update.mutate(patch, { onSuccess: onDone })
  }

  // A validation error with no fields — td's JSON type errors — has nothing to
  // bind to, so it belongs in the panel rather than silently nowhere.
  const unboundError =
    update.error instanceof ApiError && update.error.fields.length === 0
      ? update.error.message
      : null

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

      {unboundError && <ErrorPanel label="Update rejected" message={unboundError} />}
    </form>
  )
}

function FieldError({ error, field }: { error: unknown; field: string }) {
  const message = fieldErrorFor(error, field)
  if (!message) return null
  return <p className="mt-1.5 text-[11px] text-danger">{message}</p>
}
