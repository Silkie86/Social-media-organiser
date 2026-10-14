import { useState } from 'react'
import { api, useAction } from '../lib'
import { TagInput } from './TagInput'

export function ImportDialog({ source, onClose }: { source: string | null; onClose: () => void }): React.JSX.Element {
  const [shootName, setShootName] = useState('')
  const [mode, setMode] = useState<'copy' | 'in-place'>('copy')
  const [renameByDate, setRenameByDate] = useState(true)
  const [tags, setTags] = useState<string[]>([])
  const [busy, run] = useAction()

  const start = async (): Promise<void> => {
    const r = await run(() => api.importFrom(source, { mode, shootName: shootName || undefined, renameByDate, tags }))
    if (r) onClose()
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Import footage</h2>
        <p className="muted">
          {source ? (
            <>
              From <code>{source}</code>
            </>
          ) : (
            "You'll pick a folder or memory card next. Files already in your library are skipped automatically."
          )}
        </p>
        <label className="field">
          <span>What was this shoot? (optional)</span>
          <input value={shootName} placeholder="e.g. Studio session, Fabric warm-up, Garage jam" onChange={(e) => setShootName(e.target.value)} />
        </label>
        <label className="field">
          <span>Tag everything in this import (optional)</span>
          <TagInput value={tags} onChange={setTags} placeholder="studio, b2b, new tune…" />
        </label>
        <div className="field">
          <span>Where should the files go?</span>
          <label className="radio">
            <input type="radio" checked={mode === 'copy'} onChange={() => setMode('copy')} /> Copy into my Crate library, sorted by date (recommended)
          </label>
          <label className="radio">
            <input type="radio" checked={mode === 'in-place'} onChange={() => setMode('in-place')} /> Leave them where they are and just add them to the library
          </label>
        </div>
        {mode === 'copy' && (
          <label className="check">
            <input type="checkbox" checked={renameByDate} onChange={(e) => setRenameByDate(e.target.checked)} /> Start file names with the date and time they were
            filmed
          </label>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={start}>
            {source ? 'Start import' : 'Choose folder and import'}
          </button>
        </div>
      </div>
    </div>
  )
}
