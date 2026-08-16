import { Link } from 'react-router'
import { useBoards } from '../../api/boards'
import { useDeleteBoard } from '../../api/mutations'
import { unboundMessage } from '../../api/client'
import ConfirmButton from '../../components/ConfirmButton'
import EmptyState from '../../components/EmptyState'
import ErrorPanel from '../../components/ErrorPanel'
import SkeletonRows from '../../components/SkeletonRows'
import { ROW } from '../issues/columns'

export default function BoardList() {
  const { data, error, isPending } = useBoards()
  const remove = useDeleteBoard()
  const removeError = unboundMessage(remove.error)

  if (isPending) return <SkeletonRows />
  if (error) {
    return (
      <div className="p-4">
        <ErrorPanel message={unboundMessage(error) ?? 'Request failed'} />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2.5 border-b border-line bg-surface-inset px-4 py-2">
        <h1 className="text-[11px] uppercase tracking-widest text-ink-muted">Boards</h1>
        <span className="flex-1" />
        <Link to="/boards/new" className="rounded-sm border border-accent px-2.5 py-1 text-[11px] text-accent">
          New board
        </Link>
      </div>

      {removeError && (
        <div className="p-4"><ErrorPanel message={removeError} /></div>
      )}

      {data.boards.length === 0 ? (
        <EmptyState
          message="No boards yet."
          hint="A board is a saved TDQ query — create one, or run td board create."
        />
      ) : (
        <ul>
          {data.boards.map(board => (
            <li key={board.id} className={ROW}>
              <Link to={`/boards/${board.id}`} className="w-56 shrink-0 truncate text-ink">
                {board.name}
              </Link>
              <span className="flex-1 truncate font-mono text-[11px] text-ink-faint">
                {board.query || 'no query'}
              </span>
              {board.is_builtin ? (
                <span className="text-[11px] uppercase tracking-widest text-ink-faint">
                  builtin
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Link
                    to={`/boards/${board.id}/edit`}
                    className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted"
                  >
                    Edit {board.name}
                  </Link>
                  <ConfirmButton
                    label={`Delete ${board.name}`}
                    question="Delete this board?"
                    confirmLabel="Confirm delete"
                    disabled={remove.isPending}
                    onConfirm={() => remove.mutate(board.id)}
                  />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
