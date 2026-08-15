import { useState } from 'react'
import { fieldErrorFor, unboundMessage } from '../../api/client'
import { useAddComment } from '../../api/mutations'

const boundFields = ['text']

export default function CommentForm({ issueId }: { issueId: string }) {
  const [text, setText] = useState('')
  const add = useAddComment(issueId)
  const panelError = unboundMessage(add.error, boundFields)

  return (
    <form
      className="mt-3"
      onSubmit={e => {
        e.preventDefault()
        add.mutate({ text }, { onSuccess: () => setText('') })
      }}
    >
      <label htmlFor="comment" className="mb-1.5 block text-[11px] uppercase tracking-widest text-ink-muted">Comment</label>
      <textarea
        id="comment" rows={3} value={text} onChange={e => setText(e.target.value)}
        className="w-full rounded-sm border border-line bg-surface-inset px-2.5 py-2 text-ink"
      />
      {fieldErrorFor(add.error, 'text') && (
        <p className="mt-1.5 text-[11px] text-danger">{fieldErrorFor(add.error, 'text')}</p>
      )}
      {/* Everything td says that the textarea above is not already showing. */}
      {panelError && (
        <p className="mt-1.5 text-[11px] text-danger" role="alert">{panelError}</p>
      )}
      <button type="submit" disabled={add.isPending}
        className="mt-2 rounded-sm border border-accent px-3 py-1 text-[11px] text-accent disabled:opacity-40">
        Add comment
      </button>
    </form>
  )
}
