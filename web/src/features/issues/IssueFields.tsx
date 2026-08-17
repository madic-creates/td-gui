import { fieldErrorFor } from '../../api/client'
import type { Issue, IssueType, Priority } from '../../api/types'
import IssueCombobox from '../../components/IssueCombobox'
import LabelInput from './LabelInput'
import type { IssueDraft } from './issueDiff'

const types: IssueType[] = ['task', 'feature', 'bug', 'chore', 'epic']
const priorities: Priority[] = ['P0', 'P1', 'P2', 'P3', 'P4']

// Exported because both forms style their own title input with them — the one
// field that is not in here.
export const fieldClass = 'w-full rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink'
export const legendClass = 'mb-1.5 block text-[11px] uppercase tracking-widest text-ink-muted'

interface Props {
  /**
   * `new` or `edit`. Prefixes every id and htmlFor this block owns — but
   * `LabelInput`, rendered inside it, hardcodes its own `label-entry` and
   * `label-suggestions` ids, which is what makes rendering this block twice
   * on one page unsafe today.
   */
  idPrefix: string
  /** The create or update mutation's error, which the FieldErrors read. */
  error: unknown
  draft: IssueDraft
  set: <K extends keyof IssueDraft>(key: K, value: IssueDraft[K]) => void
  /**
   * Already filtered by the caller. The exclusion rule is not the same for the
   * two forms and the reason lives at the call site: an existing issue cannot
   * be its own parent or its own child, and a new one has neither.
   */
  parentCandidates: Issue[]
}

/**
 * Every field the create and edit forms share, in the order they share it.
 *
 * Presentational on purpose: no state, no query, no mutation. The form that
 * renders it owns the draft and the request, which is what lets one block
 * serve both a POST and a PATCH.
 *
 * The title and the submit controls are deliberately not in here. Create
 * renders a labelled title input; the edit form renders a heading that becomes
 * a larger, aria-labelled input, outside its `editing` gate, which is what
 * lets the title be edited where it is read. Create submits with one inline
 * button; the edit form portals Save and Cancel into a slot its caller
 * provides. A prop cannot express those differences, only hide them.
 *
 * Returns a fragment rather than a wrapper: both call sites space their
 * children with `space-y-4`, which only reaches direct DOM children.
 */
export default function IssueFields({ idPrefix, error, draft, set, parentCandidates }: Props) {
  const id = (name: string) => `${idPrefix}-${name}`

  return (
    <>
      <div>
        <label htmlFor={id('description')} className={legendClass}>Description</label>
        <textarea id={id('description')} rows={6} value={draft.description}
          onChange={e => set('description', e.target.value)} className={fieldClass} />
        <FieldError error={error} field="description" />
      </div>

      <div>
        <label htmlFor={id('acceptance')} className={legendClass}>Acceptance criteria</label>
        <textarea id={id('acceptance')} rows={4} value={draft.acceptance}
          onChange={e => set('acceptance', e.target.value)} className={fieldClass} />
        <FieldError error={error} field="acceptance" />
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div>
          <label htmlFor={id('type')} className={legendClass}>Type</label>
          <select id={id('type')} value={draft.type}
            onChange={e => set('type', e.target.value as IssueType)} className={fieldClass}>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <FieldError error={error} field="type" />
        </div>
        <div>
          <label htmlFor={id('priority')} className={legendClass}>Priority</label>
          <select id={id('priority')} value={draft.priority}
            onChange={e => set('priority', e.target.value as Priority)} className={fieldClass}>
            {priorities.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <FieldError error={error} field="priority" />
        </div>
        <div>
          {/* No min or max: the accepted values are td config, and it names
              them in the error when a value is rejected. */}
          <label htmlFor={id('points')} className={legendClass}>Points</label>
          <input id={id('points')} type="number" value={draft.points ?? ''}
            onChange={e => set('points', e.target.value === '' ? null : Number(e.target.value))}
            className={fieldClass} />
          <FieldError error={error} field="points" />
        </div>
        <div>
          <label htmlFor={id('sprint')} className={legendClass}>Sprint</label>
          <input id={id('sprint')} value={draft.sprint}
            onChange={e => set('sprint', e.target.value)} className={fieldClass} />
          <FieldError error={error} field="sprint" />
        </div>
      </div>

      <div>
        <LabelInput value={draft.labels} onChange={labels => set('labels', labels)} />
        <FieldError error={error} field="labels" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor={id('parent')} className={legendClass}>Parent</label>
          <IssueCombobox id={id('parent')} value={draft.parent_id}
            onChange={next => set('parent_id', next)}
            candidates={parentCandidates}
            placeholder="td-…" className={fieldClass} />
          <FieldError error={error} field="parent_id" />
        </div>
        <div>
          <label htmlFor={id('due')} className={legendClass}>Due date</label>
          <input id={id('due')} type="date" value={draft.due_date}
            onChange={e => set('due_date', e.target.value)} className={fieldClass} />
          <FieldError error={error} field="due_date" />
        </div>
        <div>
          <label htmlFor={id('defer')} className={legendClass}>Defer until</label>
          <input id={id('defer')} type="date" value={draft.defer_until}
            onChange={e => set('defer_until', e.target.value)} className={fieldClass} />
          <FieldError error={error} field="defer_until" />
        </div>
      </div>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={draft.minor}
          onChange={e => set('minor', e.target.checked)} />
        <span>Minor — self-reviewable</span>
      </label>
    </>
  )
}

/**
 * Every field with a `<FieldError>` of its own, across both forms. `title` is
 * on the list although it is rendered by each form rather than by this block —
 * the title is where the two forms differ, but both of them do render its
 * error at its input.
 *
 * `minor` is deliberately absent — it is the one field without a FieldError —
 * so an error naming it, or naming anything td renames later, falls through to
 * the panel instead of rendering nowhere.
 *
 * The list has to be exact in one direction and merely tidy in the other: an
 * omission here only duplicates a message, but a stale entry silences one.
 *
 * One list rather than one per form: it describes the placements above, and
 * with the placements shared there is nothing left to keep in step by hand.
 * Each form's suite still runs the completeness guard over it, so an entry
 * that renders in one form and nowhere in the other is still caught.
 */
// oxlint-disable-next-line react/only-export-components
export const boundFields = [
  'title', 'description', 'acceptance', 'type', 'priority', 'points', 'sprint',
  'labels', 'parent_id', 'due_date', 'defer_until',
]

/**
 * Exported because both forms render one for their own title input, which is
 * the field that is not in this block. No oxlint exemption above it: it is a
 * component, which is what that rule allows a component file to export.
 */
export function FieldError({ error, field }: { error: unknown; field: string }) {
  const message = fieldErrorFor(error, field)
  if (!message) return null
  return <p className="mt-1.5 text-[11px] text-danger">{message}</p>
}
