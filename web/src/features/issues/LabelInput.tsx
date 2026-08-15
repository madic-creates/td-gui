import { useState } from 'react'
import { useLabels } from '../../api/queries'

interface Props {
  value: string[]
  onChange: (labels: string[]) => void
}

/**
 * Chips plus a free-text add, suggesting labels already used in the project.
 * td does not validate labels — it accepted "has space" — so nothing here
 * rejects input either.
 */
export default function LabelInput({ value, onChange }: Props) {
  const [entry, setEntry] = useState('')
  const { data } = useLabels()

  const add = () => {
    const label = entry.trim()
    setEntry('')
    if (!label || value.includes(label)) return
    onChange([...value, label])
  }

  return (
    <div>
      <label htmlFor="label-entry" className="mb-1.5 block text-[11px] uppercase tracking-widest text-ink-muted">
        Labels
      </label>

      {value.length > 0 && (
        <ul className="mb-1.5 flex flex-wrap gap-1.5">
          {value.map(label => (
            <li key={label} className="flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 font-mono text-[11px]">
              <span>{label}</span>
              <button
                type="button"
                aria-label={`Remove label ${label}`}
                onClick={() => onChange(value.filter(l => l !== label))}
                className="text-ink-faint"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-1.5">
        <input
          id="label-entry"
          list="label-suggestions"
          value={entry}
          onChange={e => setEntry(e.target.value)}
          // Enter adds a label; without this it would submit the edit form.
          onKeyDown={e => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            add()
          }}
          className="flex-1 rounded-sm border border-line bg-surface-inset px-2.5 py-1.5 text-ink"
        />
        <button
          type="button"
          onClick={add}
          className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-ink-muted"
        >
          Add label
        </button>
      </div>

      <datalist id="label-suggestions">
        {data?.labels.map(label => <option key={label} value={label}>{label}</option>)}
      </datalist>
    </div>
  )
}
