export type IssueStatus = 'open' | 'in_progress' | 'in_review' | 'blocked' | 'closed'
export type IssueType = 'bug' | 'feature' | 'task' | 'epic' | 'chore'
export type Priority = 'P0' | 'P1' | 'P2' | 'P3' | 'P4'

export type Transition =
  | 'start' | 'review' | 'approve' | 'reject'
  | 'block' | 'unblock' | 'close' | 'reopen'

/**
 * The review currently standing on an issue. Absent until one is recorded —
 * td does not send the key at all before that, so this is optional on the
 * detail response and a missing value means "never reviewed", not "unknown".
 */
export interface ActiveReview {
  id: string
  decision: string
  reviewer_session: string
  requested_by_session: string
  summary: string
  created_at: string
  self_review: boolean
}

/** One entry of the review history, returned only under `?with=reviews`. */
export interface Review {
  id: string
  issue_id: string
  reviewer_session: string
  decision: string
  summary: string
  requested_by_session: string
  created_at: string
  self_review: boolean
}

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
  /** Present on the board and list paths only. */
  dependency_summary?: DependencySummary
  /*
   * `category` is missing on purpose. td sends it on those same two paths, but
   * nothing in its codebase ever assigns it, so it is always "". Declaring it
   * would invite a reader to branch on a value that is never anything else.
   */
  /** Present on GET /v1/issues/{id} only. Absent means "unknown". */
  available_transitions?: Transition[]
  /**
   * Present on GET /v1/issues/{id} only, and only once a review exists. td
   * nests these under `issue`, unlike `dependencies` and `blocked_by`, which
   * are siblings of it.
   */
  active_review?: ActiveReview
  /** Present only under `?with=reviews`. */
  reviews?: Review[]
}

/** POST /v1/issues */
export interface IssueCreateResponse {
  issue: Issue
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

/**
 * One unresolved blocker. td already filters closed blockers out, so every
 * entry is still in the way.
 */
export interface BlockerRef {
  dep_id: string
  /** The BLOCKER's id, i.e. depends_on_id — not the blocked issue. */
  issue_id: string
  title: string
  status: string
  relation_type: string
}

export interface DependencySummary {
  blockers: BlockerRef[]
}

export type BoardViewMode = 'swimlanes' | 'backlog'

/**
 * `view_mode` is read-only over HTTP: PATCH /v1/boards/{id} accepts name and
 * query only, so td's UpdateBoardViewMode is unreachable. The GUI treats it as
 * the initial view and keeps its own preference.
 */
export interface Board {
  id: string
  name: string
  query: string
  is_builtin: boolean
  view_mode: BoardViewMode
  last_viewed_at: string | null
  created_at: string
  updated_at: string
}

/**
 * One card on a board.
 *
 * `position` is td's sparse sort key (1000, 2000, 1500), NOT an index and NOT
 * the value POST /v1/boards/{id}/issues expects — that one is a 1-based slot.
 * Sort by it; never render it and never send it back.
 *
 * `issue` arrives without available_transitions, which only GET /v1/issues/{id}
 * carries. Description and acceptance are present, contrary to what the name
 * slimForBoard suggests — but nothing on a card renders them.
 */
export interface BoardCard {
  issue: Issue
  board_id: string
  position: number
  has_position: boolean
}

/** GET /v1/boards */
export interface BoardListResponse {
  boards: Board[]
}

/** GET /v1/boards/{id} */
export interface BoardResponse {
  board: Board
  issues: BoardCard[]
}

/** POST /v1/boards and PATCH /v1/boards/{id} */
export interface BoardCreateResponse {
  board: Board
}
