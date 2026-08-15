import { useState } from 'react'
import { Link } from 'react-router'
import { ApiError } from '../../api/client'
import { useAddDependency, useRemoveDependency } from '../../api/mutations'
import type { Dependency } from '../../api/types'
import ConfirmButton from '../../components/ConfirmButton'
import ErrorPanel from '../../components/ErrorPanel'

interface Props {
  issueId: string
  dependencies: Dependency[]
}

/**
 * Bare ids on purpose. The API returns only id triples, so titles and statuses
 * need a follow-up read of each referenced issue — that is td-7a8b61's work,
 * and this panel is written to be enriched rather than replaced.
 */
export default function DependencyPanel({ issueId, dependencies }: Props) {
  const [entry, setEntry] = useState('')
  const add = useAddDependency(issueId)
  const remove = useRemoveDependency(issueId)

  const error = add.error ?? remove.error

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[11px] uppercase tracking-widest text-ink-muted">
        Depends on ({dependencies.length})
      </h2>

      {dependencies.length > 0 && (
        <ul className="mb-2">
          {dependencies.map(dependency => (
            <li
              key={dependency.dep_id}
              className="flex items-center gap-2.5 border-b border-line-subtle py-1.5 last:border-b-0"
            >
              <Link
                to={`/issues/${dependency.depends_on_id}`}
                className="flex-1 font-mono text-[11px] text-accent"
              >
                {dependency.depends_on_id}
              </Link>
              <ConfirmButton
                label="Remove"
                question="Remove this dependency?"
                disabled={remove.isPending}
                onConfirm={() => remove.mutate(dependency.dep_id)}
              />
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex gap-1.5"
        onSubmit={event => {
          event.preventDefault()
          const id = entry.trim()
          if (!id) return
          add.mutate(id, { onSuccess: () => setEntry('') })
        }}
      >
        <label htmlFor="dependency-entry" className="sr-only">Depends on</label>
        <input
          id="dependency-entry"
          value={entry}
          placeholder="td-…"
          onChange={event => setEntry(event.target.value)}
          className="flex-1 rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 font-mono text-ink"
        />
        <button
          type="submit"
          disabled={add.isPending}
          className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted disabled:opacity-40"
        >
          Add dependency
        </button>
      </form>

      {error && (
        // No details.fields on these — "would create circular dependency",
        // "issue not found: td-zzzzzz" — so the message is all there is.
        <div className="mt-2">
          <ErrorPanel
            label="Dependency rejected"
            message={error instanceof ApiError ? error.message : String(error)}
          />
        </div>
      )}
    </section>
  )
}
