import type { IssueInput } from '../../api/mutations'
import type { IssueDraft } from './issueDiff'

/** The form's starting state: nothing filled, on the defaults the selects show. */
export function blankDraft(): IssueDraft {
  return {
    title: '', description: '', acceptance: '', type: 'task', priority: 'P2',
    points: null, labels: [], parent_id: '', sprint: '', minor: false,
    defer_until: '', due_date: '',
  }
}

/**
 * The create body, and the counterpart to diffIssue: where that one omits what
 * has not changed, this omits what was never filled. td applies its own
 * defaults to an absent field, so an empty one must not go out as `""` — that
 * would store a blank the project's config had an opinion about.
 *
 * title, type and priority always go out. All three are visible in the form,
 * so sending them states what the reader can see; the rest are empty until
 * touched.
 */
export function createBodyFrom(draft: IssueDraft): IssueInput {
  const body: IssueInput = {
    title: draft.title,
    type: draft.type,
    priority: draft.priority,
  }

  if (draft.description) body.description = draft.description
  if (draft.acceptance) body.acceptance = draft.acceptance
  if (draft.sprint) body.sprint = draft.sprint
  if (draft.parent_id) body.parent_id = draft.parent_id
  if (draft.due_date) body.due_date = draft.due_date
  if (draft.defer_until) body.defer_until = draft.defer_until
  if (draft.labels.length > 0) body.labels = draft.labels
  if (draft.minor) body.minor = true

  // null is the empty input. A NaN — an unparseable entry — would serialise to
  // null and be read as "no value", so it is dropped rather than sent, the
  // same call diffIssue makes.
  if (draft.points !== null && Number.isFinite(draft.points)) body.points = draft.points

  return body
}
