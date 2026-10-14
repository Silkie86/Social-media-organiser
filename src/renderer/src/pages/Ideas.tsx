import { useState } from 'react'
import type { Idea } from '@shared/types'
import { api, useAction, useLoad, useNav } from '../lib'

export function Ideas(): React.JSX.Element {
  const nav = useNav()
  const ideas = useLoad(() => api.listIdeas())
  const settings = useLoad(() => api.getSettings())
  const [busy, run] = useAction()
  const [focus, setFocus] = useState('')
  const [pillar, setPillar] = useState('')
  const [count, setCount] = useState(6)
  const [manual, setManual] = useState('')

  const generate = async (): Promise<void> => {
    const r = await run(() => api.generateIdeas({ count, focus: focus || undefined, pillar: pillar || undefined }))
    if (r) ideas.reload()
  }
  const setStatus = (i: Idea, status: Idea['status']): void => void run(() => api.updateIdea(i.id, { status })).then(ideas.reload)
  const toPost = async (i: Idea): Promise<void> => {
    const post = await run(() => api.ideaToPost(i.id), 'Added to your planner as a draft')
    if (post) nav.go('planner', { id: post.id })
  }

  const hasKey = settings.data?.hasClaudeKey
  return (
    <div className="page">
      <h1>Ideas</h1>
      <div className="card">
        <h3>Ask Claude for ideas</h3>
        {!hasKey && settings.data && (
          <p className="warn-text">
            Add your Claude API key in{' '}
            <button className="link" onClick={() => nav.go('settings')}>
              Settings
            </button>{' '}
            to get ideas. Ideas use your artist profile and the footage in your library.
          </p>
        )}
        <div className="row wrap">
          <input className="grow" value={focus} placeholder="Anything to focus on? e.g. my EP drops on the 24th, a gig at the weekend, using old festival footage" onChange={(e) => setFocus(e.target.value)} />
          <select value={pillar} onChange={(e) => setPillar(e.target.value)}>
            <option value="">Any pillar</option>
            {(settings.data?.pillars ?? []).map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[3, 6, 10].map((n) => (
              <option key={n} value={n}>
                {n} ideas
              </option>
            ))}
          </select>
          <button className="btn btn-primary" disabled={busy || !hasKey} onClick={generate}>
            {busy ? 'Thinking…' : '✦ Get ideas'}
          </button>
        </div>
        <div className="row">
          <input
            className="grow"
            value={manual}
            placeholder="Or jot down your own idea and press Enter"
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && manual.trim()) {
                void run(() => api.savePost({ title: manual.trim(), status: 'draft' }), 'Saved as a draft in your planner').then(() => setManual(''))
              }
            }}
          />
        </div>
      </div>
      {ideas.error && <p className="error">{ideas.error}</p>}
      <div className="idea-grid">
        {(ideas.data ?? []).map((i) => (
          <div key={i.id} className={`card idea ${i.status}`}>
            <div className="row space">
              <span className="pill">{i.pillar}</span>
              <span className="muted small">{i.format}</span>
            </div>
            <h3>{i.title}</h3>
            {i.hook && <p className="hook">“{i.hook}”</p>}
            <p>{i.description}</p>
            <div className="row">
              <button className="btn btn-primary btn-small" onClick={() => toPost(i)}>
                Plan it
              </button>
              {i.status !== 'saved' && (
                <button className="btn btn-small" onClick={() => setStatus(i, 'saved')}>
                  Save for later
                </button>
              )}
              <button className="btn btn-ghost btn-small" onClick={() => setStatus(i, 'dismissed')}>
                Not for me
              </button>
            </div>
          </div>
        ))}
      </div>
      {!ideas.loading && !(ideas.data ?? []).length && <div className="empty">No ideas yet. Ask Claude above, it takes about half a minute.</div>}
    </div>
  )
}
