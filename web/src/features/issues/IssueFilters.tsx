import type { IssueListParams } from '../../api/queries'
import type { IssueStatus } from '../../api/types'

const statuses: { value: IssueStatus; label: string }[] = [
  { value: 'open', label: 'Offen' },
  { value: 'in_progress', label: 'In Arbeit' },
  { value: 'in_review', label: 'Im Review' },
  { value: 'blocked', label: 'Blockiert' },
  { value: 'closed', label: 'Geschlossen' },
]

interface Props {
  params: IssueListParams
  onChange: (next: IssueListParams) => void
}

export default function IssueFilters({ params, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        type="search"
        aria-label="Suche"
        placeholder="Suchen …"
        className="rounded border px-3 py-1"
        defaultValue={params.search ?? ''}
        onChange={e => onChange({ ...params, search: e.target.value || undefined })}
      />
      {statuses.map(s => {
        const active = params.status?.includes(s.value) ?? false
        return (
          <label key={s.value} className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={() => {
                const current = params.status ?? []
                const next = active
                  ? current.filter(v => v !== s.value)
                  : [...current, s.value]
                onChange({ ...params, status: next.length ? next : undefined })
              }}
            />
            {s.label}
          </label>
        )
      })}
    </div>
  )
}
