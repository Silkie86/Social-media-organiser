import { useState } from 'react'
import { api, useAction } from '../lib'

export function ClaudeKey({ hasKey, onSaved }: { hasKey: boolean; onSaved: () => void }): React.JSX.Element {
  const [key, setKey] = useState('')
  const [busy, run] = useAction()
  const [error, setError] = useState<string | null>(null)
  const save = async (): Promise<void> => {
    setError(null)
    const r = await run(() => api.setClaudeKey(key))
    if (r?.ok) {
      setKey('')
      onSaved()
    } else if (r?.error) setError(r.error)
  }
  return (
    <div>
      <p className="muted">
        {hasKey ? '✓ Your Claude key is saved (encrypted on this computer).' : 'Ideas and captions are written by Claude. You need your own API key for that.'}{' '}
        Get one at{' '}
        <button className="link" onClick={() => api.openExternal('https://console.anthropic.com/settings/keys')}>
          console.anthropic.com
        </button>
        : sign up, add a few pounds of credit under Billing, then <em>API keys → Create key</em> and paste it here. A batch of ideas costs a few pence.
      </p>
      <div className="row">
        <input className="grow" type="password" value={key} placeholder={hasKey ? 'Paste a new key to replace it' : 'sk-ant-…'} onChange={(e) => setKey(e.target.value)} />
        <button className="btn btn-primary" disabled={busy || !key.trim()} onClick={save}>
          {busy ? 'Checking…' : 'Save key'}
        </button>
        {hasKey && (
          <button className="btn btn-ghost" disabled={busy} onClick={() => run(() => api.setClaudeKey('')).then(onSaved)}>
            Remove
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
