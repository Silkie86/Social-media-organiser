import { useState } from 'react'

export function TagInput({
  value,
  onChange,
  placeholder,
  suggestions = [],
  prefix = ''
}: {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  suggestions?: string[]
  prefix?: string
}): React.JSX.Element {
  const [text, setText] = useState('')
  const add = (raw: string): void => {
    const parts = raw
      .split(/[,\s]+/)
      .map((t) => t.replace(/^#/, '').trim())
      .filter(Boolean)
    if (parts.length) onChange([...new Set([...value, ...parts])])
    setText('')
  }
  const unused = suggestions.filter((s) => !value.includes(s)).slice(0, 12)
  return (
    <div>
      <div className="tag-input">
        {value.map((t) => (
          <span key={t} className="chip">
            {prefix}
            {t}
            <button onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
              ×
            </button>
          </span>
        ))}
        <input
          value={text}
          placeholder={value.length ? '' : placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add(text)
            } else if (e.key === 'Backspace' && !text && value.length) {
              onChange(value.slice(0, -1))
            }
          }}
          onBlur={() => text && add(text)}
        />
      </div>
      {unused.length > 0 && (
        <div className="suggestions">
          {unused.map((s) => (
            <button key={s} className="chip chip-ghost" onClick={() => onChange([...value, s])}>
              + {prefix}
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
