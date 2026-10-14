import { useEffect, useState } from 'react'
import type { AppSettings, HashtagSet } from '@shared/types'
import { api, useAction, useLoad } from '../lib'
import { ProfileFields } from '../components/ProfileFields'
import { ClaudeKey } from '../components/ClaudeKey'
import { TagInput } from '../components/TagInput'

export function SettingsPage({ onSaved }: { onSaved: () => void }): React.JSX.Element {
  const loaded = useLoad(() => api.getSettings())
  const [s, setS] = useState<AppSettings | null>(null)
  const [busy, run] = useAction()
  useEffect(() => {
    if (loaded.data) setS(loaded.data)
  }, [loaded.data])
  if (!s) return <div className="page">Loading…</div>

  const save = async (): Promise<void> => {
    const { hasClaudeKey: _k, ...rest } = s
    const r = await run(() => api.updateSettings(rest), 'Settings saved')
    if (r) {
      setS(r)
      onSaved()
    }
  }
  const set = (patch: Partial<AppSettings>): void => setS({ ...s, ...patch })

  return (
    <div className="page">
      <div className="page-head">
        <h1>Settings</h1>
        <button className="btn btn-primary" disabled={busy} onClick={save}>
          Save changes
        </button>
      </div>

      <section className="card">
        <h2>You, the artist</h2>
        <p className="muted">Claude uses this for ideas and captions. The more specific, the better they get.</p>
        <ProfileFields value={s.profile} onChange={(profile) => set({ profile })} />
        <label className="field">
          <span>Sign-off added to captions (optional)</span>
          <input value={s.captionSignature} placeholder="e.g. New EP out 24th, link in bio" onChange={(e) => set({ captionSignature: e.target.value })} />
        </label>
        <label className="field">
          <span>Content pillars (the kinds of posts you rotate through)</span>
          <TagInput value={s.pillars} onChange={(pillars) => set({ pillars })} />
        </label>
      </section>

      <section className="card">
        <h2>Posting rhythm and reminders</h2>
        <div className="grid-2">
          <label className="field">
            <span>Posts per week goal</span>
            <input type="number" min={1} max={30} value={s.weeklyPostGoal} onChange={(e) => set({ weeklyPostGoal: Number(e.target.value) || 1 })} />
          </label>
          <label className="field">
            <span>Remind me this many minutes before a post</span>
            <input type="number" min={0} max={240} value={s.reminderMinutesBefore} onChange={(e) => set({ reminderMinutesBefore: Number(e.target.value) || 0 })} />
          </label>
          <label className="field">
            <span>Daily check-in after (hour, 24h clock)</span>
            <input type="number" min={0} max={23} value={s.dailyNudgeHour} onChange={(e) => set({ dailyNudgeHour: Number(e.target.value) || 0 })} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={s.minimiseToTray} onChange={(e) => set({ minimiseToTray: e.target.checked })} /> Keep running in the system tray when I close
          the window, so reminders still arrive
        </label>
        <label className="check">
          <input type="checkbox" checked={s.startWithSystem} onChange={(e) => set({ startWithSystem: e.target.checked })} /> Start Crate quietly when my computer starts
        </label>
      </section>

      <section className="card">
        <h2>Library and footage</h2>
        <label className="field">
          <span>Library folder</span>
          <div className="row">
            <input className="grow" value={s.libraryRoot} readOnly />
            <button className="btn" onClick={() => api.pickFolder('Choose where to keep your library').then((p) => p && set({ libraryRoot: p }))}>
              Change
            </button>
          </div>
          <small className="muted">Changing this only affects new imports and exports. Existing files stay where they are.</small>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.autoDetectCards} onChange={(e) => set({ autoDetectCards: e.target.checked })} /> Notice when I plug in a camera card and offer to
          import it
        </label>
        <label className="field">
          <span>LUT for S-Log footage (.cube file, optional)</span>
          <div className="row">
            <input className="grow" value={s.lutPath} placeholder="e.g. Sony's SLog3SGamut3.CineToLC-709.cube" readOnly />
            <button className="btn" onClick={() => api.pickFile('Choose a LUT file', ['cube']).then((p) => p && set({ lutPath: p }))}>
              Choose
            </button>
            {s.lutPath && (
              <button className="btn btn-ghost" onClick={() => set({ lutPath: '' })}>
                Clear
              </button>
            )}
          </div>
          <small className="muted">If you film in S-Log3, Sony's free LUTs make it look normal. Crate applies it automatically to clips marked as S-Log when exporting.</small>
        </label>
      </section>

      <section className="card">
        <h2>Claude (ideas and captions)</h2>
        <ClaudeKey hasKey={s.hasClaudeKey} onSaved={() => loaded.reload()} />
      </section>

      <section className="card">
        <h2>Hashtag sets</h2>
        <p className="muted">Save groups of hashtags you use a lot, then add them to a post with one click.</p>
        <HashtagSets />
      </section>
    </div>
  )
}

function HashtagSets(): React.JSX.Element {
  const sets = useLoad(() => api.listHashtagSets())
  const [, run] = useAction()
  const [draft, setDraft] = useState<{ id?: number; name: string; tags: string[] }>({ name: '', tags: [] })
  const save = (): void => void run(() => api.saveHashtagSet(draft), 'Hashtag set saved').then(() => (setDraft({ name: '', tags: [] }), sets.reload()))
  return (
    <div>
      {(sets.data ?? []).map((h: HashtagSet) => (
        <div key={h.id} className="list-row">
          <strong>{h.name}</strong>
          <span className="muted ellipsis">{h.tags.map((t) => `#${t}`).join(' ')}</span>
          <button className="link" onClick={() => setDraft(h)}>
            Edit
          </button>
          <button className="link" onClick={() => run(() => api.deleteHashtagSet(h.id)).then(sets.reload)}>
            Delete
          </button>
        </div>
      ))}
      <div className="hashtag-form">
        <input value={draft.name} placeholder="Set name, e.g. Dubstep core" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <TagInput value={draft.tags} onChange={(tags) => setDraft({ ...draft, tags })} prefix="#" placeholder="dubstep, 140, bassmusic…" />
        <button className="btn" disabled={!draft.name || !draft.tags.length} onClick={save}>
          {draft.id ? 'Update set' : 'Add set'}
        </button>
      </div>
    </div>
  )
}
