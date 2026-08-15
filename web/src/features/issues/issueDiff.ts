import type { Issue, IssuePatch, IssueType, Priority } from '../../api/types'

/**
 * The editable shape the form holds. Every field is present because a
 * controlled input always has a value; the nullable issue fields become empty
 * strings so an untouched draft diffs to nothing.
 */
export interface IssueDraft {
  title: string
  description: string
  acceptance: string
  type: IssueType
  priority: Priority
  /** null is the empty input, which clears the estimate. */
  points: number | null
  labels: string[]
  parent_id: string
  sprint: string
  minor: boolean
  defer_until: string
  due_date: string
}

export function draftFrom(issue: Issue): IssueDraft {
  return {
    title: issue.title,
    description: issue.description,
    acceptance: issue.acceptance,
    type: issue.type,
    priority: issue.priority,
    points: issue.points === 0 ? null : issue.points,
    labels: [...issue.labels],
    parent_id: issue.parent_id ?? '',
    sprint: issue.sprint,
    minor: issue.minor,
    defer_until: issue.defer_until ?? '',
    due_date: issue.due_date ?? '',
  }
}

const sameLabels = (a: string[], b: string[]) =>
  a.length === b.length && a.every((label, i) => label === b[i])

/**
 * The minimal PATCH body. A field equal to the stored issue is omitted, which
 * is what makes "omitted fields stay unchanged" true by construction rather
 * than by discipline.
 *
 * Clearing is deliberately never `null`: td reads a null on defer_until,
 * due_date or parent_id as "field absent" and leaves the value alone. Only an
 * empty string clears. points inverts this — it clears with 0, and an empty
 * string fails as a JSON type error with no field details to bind to.
 */
export function diffIssue(original: Issue, draft: IssueDraft): IssuePatch {
  const patch: IssuePatch = {}

  if (draft.title !== original.title) patch.title = draft.title
  if (draft.description !== original.description) patch.description = draft.description
  if (draft.acceptance !== original.acceptance) patch.acceptance = draft.acceptance
  if (draft.type !== original.type) patch.type = draft.type
  if (draft.priority !== original.priority) patch.priority = draft.priority
  if (draft.sprint !== original.sprint) patch.sprint = draft.sprint
  if (draft.minor !== original.minor) patch.minor = draft.minor
  if (!sameLabels(draft.labels, original.labels)) patch.labels = draft.labels

  // A NaN would serialise to null, which td silently ignores — so an
  // unparseable entry counts as no change rather than as a lost edit.
  const points = draft.points ?? 0
  if (points !== original.points && Number.isFinite(points)) patch.points = points

  if (draft.parent_id !== (original.parent_id ?? '')) patch.parent_id = draft.parent_id
  if (draft.defer_until !== (original.defer_until ?? '')) patch.defer_until = draft.defer_until
  if (draft.due_date !== (original.due_date ?? '')) patch.due_date = draft.due_date

  return patch
}

/** An empty patch means the form closes without issuing a request at all. */
export const isEmptyPatch = (patch: IssuePatch) => Object.keys(patch).length === 0
