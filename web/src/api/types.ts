export type IssueStatus = 'open' | 'in_progress' | 'in_review' | 'blocked' | 'closed'
export type IssueType = 'bug' | 'feature' | 'task' | 'epic' | 'chore'
export type Priority = 'P0' | 'P1' | 'P2' | 'P3' | 'P4'

export type Transition =
  | 'start' | 'review' | 'approve' | 'reject'
  | 'block' | 'unblock' | 'close' | 'reopen'

export interface Issue {
  id: string
  title: string
  description: string
  status: IssueStatus
  type: IssueType
  priority: Priority
  points: number
  labels: string[]
  parent_id: string | null
  acceptance: string
  sprint: string
  implementer_session: string | null
  creator_session: string | null
  reviewer_session: string | null
  review_requested_by_session: string | null
  closed_by_session: string | null
  created_at: string
  updated_at: string
  reviewed_at: string | null
  closed_at: string | null
  deleted_at: string | null
  minor: boolean
  created_branch: string | null
  defer_until: string | null
  due_date: string | null
  defer_count: number
  /** Present on GET /v1/issues/{id} only. Absent means "unknown". */
  available_transitions?: Transition[]
}

/** GET /v1/issues — note this is NOT the generic {items, pagination} shape. */
export interface IssueListResponse {
  issues: Issue[]
  limit: number
  offset: number
  total: number
  has_more: boolean
}

export interface LogEntry {
  id: string
  issue_id: string
  session_id: string
  work_session_id: string
  message: string
  type: string
  timestamp: string
}

export interface Comment {
  id: string
  issue_id: string
  session_id: string
  text: string
  created_at: string
}

export interface Handoff {
  id: string
  issue_id: string
  session_id: string
  done: string[]
  remaining: string[]
  decisions: string[]
  uncertain: string[]
  timestamp: string
}

export interface Dependency {
  dep_id: string
  issue_id: string
  depends_on_id: string
  relation_type: string
}

/** GET /v1/issues/{id} — the issue fields are nested under `issue`. */
export interface IssueDetail {
  issue: Issue
  logs: LogEntry[]
  comments: Comment[]
  dependencies: Dependency[]
  blocked_by: Dependency[]
  latest_handoff: Handoff | null
}

/**
 * The PATCH /v1/issues/{id} body. Every field is optional: an absent field
 * means "leave unchanged".
 *
 * Nullable fields clear with an empty string, not with null — td treats a null
 * here as "field absent" and leaves the stored value alone. points is the
 * exception: it clears with 0 and rejects "" with a JSON type error.
 */
export interface IssuePatch {
  title?: string
  description?: string
  acceptance?: string
  type?: IssueType
  priority?: Priority
  points?: number
  labels?: string[]
  parent_id?: string
  sprint?: string
  minor?: boolean
  defer_until?: string
  due_date?: string
}

/** GET /v1/labels. It also returns `workflows`, which the GUI does not use. */
export interface LabelsResponse {
  default_workflow: string
  labels: string[]
}

export interface FieldError {
  field: string
  rule: string
  value?: unknown
  expected?: unknown
  message: string
}

export type ApiErrorCode =
  | 'validation_error' | 'unauthorized' | 'forbidden'
  | 'not_found' | 'conflict' | 'internal'
