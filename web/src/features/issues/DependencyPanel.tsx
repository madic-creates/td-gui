import { useState } from 'react'
import { ApiError } from '../../api/client'
import { useAddDependency, useRemoveDependency } from '../../api/mutations'
import type { Dependency } from '../../api/types'
import ConfirmButton from '../../components/ConfirmButton'
import ErrorPanel from '../../components/ErrorPanel'
import { useIssueIndex } from './useIssueIndex'
import { isResolved, resolve, type Related } from './issueIndex'
import { RelatedRow } from './RelatedIssues'

interface Props {
  issueId: string
  dependencies: Dependency[]
}

export default function DependencyPanel({ issueId, dependencies }: Props) {
  const [entry, setEntry] = useState('')
  const add = useAddDependency(issueId)
  const remove = useRemoveDependency(issueId)

  // Each mutation's error is only ever current for the action that produced
  // it, so a stale add failure can't keep rendering next to an unrelated
  // remove success, or mask a fresh remove failure. Selecting the outcome
  // rather than reset()ing the sibling keeps a pending request attached to
  // its observer — reset() would detach one mid-flight and drop its answer.
  // See IssueActions for the same pattern.
  const [lastAction, setLastAction] = useState<'add' | 'remove' | null>(null)
  const error = lastAction === 'add' ? add.error : lastAction === 'remove' ? remove.error : null

  // Dependencies carry only id triples; titles come from the shared index.
  const { index } = useIssueIndex()
  const related = resolve(dependencies, index, 'depends_on_id')
  const active = related.filter(item => !isResolved(item))
  const resolved = related.filter(isResolved)

  const depIdFor = (id: string) =>
    dependencies.find(d => d.depends_on_id === id)?.dep_id ?? ''

  return (
    <section className="mt-6">
      <Group
        title="Depends on"
        items={active}
        disabled={remove.isPending}
        depIdFor={depIdFor}
        onRemove={depId => { setLastAction('remove'); remove.mutate(depId) }}
      />
      <Group
        title="Resolved"
        items={resolved}
        disabled={remove.isPending}
        depIdFor={depIdFor}
        onRemove={depId => { setLastAction('remove'); remove.mutate(depId) }}
      />

      <form
        className="flex gap-1.5"
        onSubmit={event => {
          event.preventDefault()
          const id = entry.trim()
          if (!id) return
          setLastAction('add')
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

/**
 * One group of blockers. The row markup comes from RelatedRow so this panel
 * and the read-only relation sections cannot drift apart; only the remove
 * control is this panel's own.
 *
 * That control stays on every row, resolved included: a dependency on a closed
 * issue is still a dependency, and taking it off is exactly what a reader is
 * likely to want here.
 */
function Group({
  title,
  items,
  onRemove,
  disabled,
  depIdFor,
}: {
  title: string
  items: Related[]
  onRemove: (depId: string) => void
  disabled: boolean
  depIdFor: (id: string) => string
}) {
  if (items.length === 0) return null
  return (
    <>
      <h2 className="mb-2 text-[11px] uppercase tracking-widest text-ink-muted">
        {title} ({items.length})
      </h2>
      <ul className="mb-2">
        {items.map(item => (
          <RelatedRow key={item.id} {...item}>
            <ConfirmButton
              label="Remove"
              question="Remove this dependency?"
              disabled={disabled}
              onConfirm={() => onRemove(depIdFor(item.id))}
            />
          </RelatedRow>
        ))}
      </ul>
    </>
  )
}
