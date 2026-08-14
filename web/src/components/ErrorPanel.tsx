interface Props {
  /** Rendered verbatim. Never reword what td sent. */
  message: string
  label?: string
}

export default function ErrorPanel({ message, label = 'Request failed' }: Props) {
  return (
    <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-3.5 py-3">
      <p className="mb-1.5 text-[11px] uppercase tracking-widest text-danger">{label}</p>
      <p className="text-danger">{message}</p>
    </div>
  )
}
