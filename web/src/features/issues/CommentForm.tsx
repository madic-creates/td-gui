import { useState } from 'react'
import { ApiError, fieldErrorFor } from '../../api/client'
import { useAddComment } from '../../api/mutations'

export default function CommentForm({ issueId }: { issueId: string }) {
  const [text, setText] = useState('')
  const add = useAddComment(issueId)

  return (
    <form
      className="mt-3"
      onSubmit={e => {
        e.preventDefault()
        add.mutate({ text }, { onSuccess: () => setText('') })
      }}
    >
      <label htmlFor="comment" className="mb-1.5 block text-[10px] uppercase tracking-widest text-ink-muted">Comment</label>
      <textarea
        id="comment" rows={3} value={text} onChange={e => setText(e.target.value)}
        className="w-full rounded-sm border border-line bg-surface-inset px-2.5 py-2 font-sans text-[12.5px] text-ink"
      />
      {fieldErrorFor(add.error, 'text') && (
        <p className="mt-1.5 text-[11px] text-danger">{fieldErrorFor(add.error, 'text')}</p>
      )}
      {add.error instanceof ApiError && add.error.code !== 'validation_error' && (
        <p className="mt-1.5 text-[11px] text-danger" role="alert">{add.error.message}</p>
      )}
      <button type="submit" disabled={add.isPending}
        className="mt-2 rounded-sm border border-accent px-3 py-1 text-[11px] text-accent disabled:opacity-40">
        Add comment
      </button>
    </form>
  )
}
