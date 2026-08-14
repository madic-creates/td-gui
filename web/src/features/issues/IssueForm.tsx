import { useState } from 'react'
import { ApiError, fieldErrorFor } from '../../api/client'
import { useCreateIssue } from '../../api/mutations'
import type { IssueType, Priority } from '../../api/types'
import ErrorPanel from '../../components/ErrorPanel'

const types: IssueType[] = ['task', 'feature', 'bug', 'chore', 'epic']
const priorities: Priority[] = ['P0', 'P1', 'P2', 'P3', 'P4']

export default function IssueForm() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<IssueType>('task')
  const [priority, setPriority] = useState<Priority>('P2')
  const create = useCreateIssue()

  // No client-side length checks: td's title bounds are per-project config,
  // so any hardcoded value here would eventually be wrong.
  return (
    <form
      className="max-w-xl space-y-4 px-5 py-4"
      onSubmit={e => {
        e.preventDefault()
        create.mutate({ title, description: description || undefined, type, priority })
      }}
    >
      <div>
        <label htmlFor="title" className="mb-1.5 block text-[10px] uppercase tracking-widest text-ink-muted">Title</label>
        <input
          id="title" value={title} onChange={e => setTitle(e.target.value)}
          className="w-full rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink"
        />
        <FieldError error={create.error} field="title" />
      </div>

      <div>
        <label htmlFor="description" className="mb-1.5 block text-[10px] uppercase tracking-widest text-ink-muted">Description</label>
        <textarea
          id="description" rows={5} value={description}
          onChange={e => setDescription(e.target.value)}
          className="w-full rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 font-sans text-[12.5px] text-ink"
        />
        <FieldError error={create.error} field="description" />
      </div>

      <div className="flex gap-4">
        <div>
          <label htmlFor="type" className="mb-1.5 block text-[10px] uppercase tracking-widest text-ink-muted">Type</label>
          <select
            id="type" value={type} onChange={e => setType(e.target.value as IssueType)}
            className="rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink"
          >
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="priority" className="mb-1.5 block text-[10px] uppercase tracking-widest text-ink-muted">Priority</label>
          <select
            id="priority" value={priority} onChange={e => setPriority(e.target.value as Priority)}
            className="rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink"
          >
            {priorities.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      <button type="submit" disabled={create.isPending}
        className="rounded-sm border border-accent px-3 py-1 text-[11px] text-accent disabled:opacity-40">
        Create
      </button>

      {create.isSuccess && <p className="text-success">Issue created.</p>}

      {create.error instanceof ApiError && create.error.code !== 'validation_error' && (
        <ErrorPanel message={create.error.message} />
      )}
    </form>
  )
}

function FieldError({ error, field }: { error: unknown; field: string }) {
  const message = fieldErrorFor(error, field)
  if (!message) return null
  return <p className="mt-1.5 text-[11px] text-danger">{message}</p>
}
