import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { fieldErrorFor, unboundMessage } from '../../api/client'
import { useBoards } from '../../api/boards'
import { useCreateBoard, useUpdateBoard } from '../../api/mutations'
import ErrorPanel from '../../components/ErrorPanel'
import SkeletonRows from '../../components/SkeletonRows'
import type { Board } from '../../api/types'

const boundFields = ['name', 'query']

/**
 * Serves /boards/new and /boards/:id/edit. Editing waits for the board list —
 * lighter than GET /v1/boards/{id}, which would also fetch every card — and
 * remounts the body by key so the fields initialise from it exactly once.
 */
export default function BoardForm() {
  const { id } = useParams()
  const { data, error, isPending } = useBoards()

  if (id === undefined) return <Body board={null} />
  // Two fields wait behind this, not a list.
  if (isPending) return <SkeletonRows label="Loading board" rows={2} />
  if (error) {
    return (
      <div className="p-4">
        <ErrorPanel message={unboundMessage(error) ?? 'Request failed'} />
      </div>
    )
  }

  const board = data.boards.find(b => b.id === id)
  if (!board) {
    return <div className="p-4"><ErrorPanel message={`board not found: ${id}`} /></div>
  }
  return <Body key={board.id} board={board} />
}

function Body({ board }: { board: Board | null }) {
  const [name, setName] = useState(board?.name ?? '')
  const [query, setQuery] = useState(board?.query ?? '')
  const create = useCreateBoard()
  const update = useUpdateBoard(board?.id ?? '')
  const navigate = useNavigate()

  const mutation = board ? update : create
  const panelError = unboundMessage(mutation.error, boundFields)

  // Same guard as IssueForm: the disabled attribute reads from state and does
  // not stop a second native submit landing in the same tick.
  const submitting = useRef(false)

  return (
    <form
      className="max-w-xl space-y-4 px-5 py-4"
      onSubmit={e => {
        e.preventDefault()
        if (submitting.current) return
        submitting.current = true
        mutation.mutate(
          { name, query },
          {
            onSuccess: result => navigate(`/boards/${board ? board.id : result.board.id}`),
            onSettled: () => { submitting.current = false },
          },
        )
      }}
    >
      <div>
        <label htmlFor="board-name" className="mb-1.5 block text-[11px] uppercase tracking-widest text-ink-muted">
          Name
        </label>
        <input
          id="board-name" value={name} onChange={e => setName(e.target.value)}
          className="w-full rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink"
        />
        <FieldError error={mutation.error} field="name" />
      </div>

      <div>
        <label htmlFor="board-query" className="mb-1.5 block text-[11px] uppercase tracking-widest text-ink-muted">
          Query
        </label>
        {/* No client-side TDQ parsing: td owns the grammar and phrases the
            failure. An empty query is legal and means "hand-positioned only". */}
        <input
          id="board-query" value={query} onChange={e => setQuery(e.target.value)}
          className="w-full rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 font-mono text-ink"
        />
        <FieldError error={mutation.error} field="query" />
        <p className="mt-1.5 text-[11px] text-ink-faint">
          TDQ, for example <span className="font-mono">priority &lt;= P1 AND type = bug</span>.
          Leave empty to show only hand-positioned issues.
        </p>
      </div>

      <button
        type="submit" disabled={mutation.isPending}
        className="rounded-sm border border-accent px-3 py-1 text-[11px] text-accent disabled:opacity-40"
      >
        {board ? 'Save board' : 'Create board'}
      </button>

      {panelError && <ErrorPanel message={panelError} />}
    </form>
  )
}

function FieldError({ error, field }: { error: unknown; field: string }) {
  const message = fieldErrorFor(error, field)
  if (!message) return null
  return <p className="mt-1.5 text-[11px] text-danger">{message}</p>
}
