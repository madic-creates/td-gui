import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { useBoard } from '../../api/boards'
import { unboundMessage } from '../../api/client'
import EmptyState from '../../components/EmptyState'
import ErrorPanel from '../../components/ErrorPanel'
import SkeletonRows from '../../components/SkeletonRows'
import BacklogView from './BacklogView'
import SwimlaneView from './SwimlaneView'
import { isViewMode, readStoredView, storeView } from './viewMode'
import type { BoardViewMode } from '../../api/types'

export default function BoardView() {
  const { id = '' } = useParams()
  const [search, setSearch] = useSearchParams()
  const [includeClosed, setIncludeClosed] = useState(false)
  const { data, error, isPending } = useBoard(id, includeClosed)

  if (isPending) return <SkeletonRows label="Loading board" />
  if (error) {
    return (
      <div className="p-4">
        <ErrorPanel message={unboundMessage(error) ?? 'Request failed'} />
      </div>
    )
  }

  const { board, issues } = data

  // Precedence: the url, then this browser's last choice for this board, then
  // td's own view_mode. td's value is a default, not a setting we can write —
  // PATCH /v1/boards/{id} accepts name and query only.
  const param = search.get('view')
  const view: BoardViewMode =
    isViewMode(param) ? param : readStoredView(board.id) ?? board.view_mode

  const setView = (next: BoardViewMode) => {
    storeView(board.id, next)
    const params = new URLSearchParams(search)
    params.set('view', next)
    setSearch(params, { replace: true })
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-surface-inset px-4 py-2">
        <h1 className="text-ink">{board.name}</h1>
        <span className="font-mono text-[11px] text-ink-faint">
          {board.query || 'no query'}
        </span>
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 text-[11px] text-ink-muted">
          <input
            type="checkbox"
            checked={includeClosed}
            onChange={e => setIncludeClosed(e.target.checked)}
          />
          Include closed
        </label>
        <ViewToggle view={view} onChange={setView} />
      </div>

      {/* Emptiness is decided first. A query-less board matches every issue,
          so reaching this branch means the project itself has nothing to show
          — pointing at the query would send the user to fix the wrong thing. */}
      {issues.length === 0 ? (
        board.query === '' ? (
          <EmptyState
            message="No issues yet."
            hint="This board has no query, so it shows every issue in the project. Closed issues are hidden unless you include them."
          />
        ) : (
          <EmptyState
            message="No issues on this board."
            hint="Nothing matches its query right now. Closed issues are hidden unless you include them."
          />
        )
      ) : view === 'backlog' ? (
        <BacklogView boardId={board.id} cards={issues} />
      ) : (
        <SwimlaneView cards={issues} includeClosed={includeClosed} />
      )}
    </div>
  )
}

function ViewToggle({
  view, onChange,
}: {
  view: BoardViewMode
  onChange: (next: BoardViewMode) => void
}) {
  const modes: [BoardViewMode, string][] = [['backlog', 'Backlog'], ['swimlanes', 'Swimlanes']]
  return (
    <span className="flex items-center gap-1">
      {modes.map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={view === value}
          onClick={() => onChange(value)}
          className={`rounded-sm border px-2.5 py-1 text-[11px] ${
            view === value ? 'border-accent text-accent' : 'border-line text-ink-muted'
          }`}
        >
          {label}
        </button>
      ))}
    </span>
  )
}
