import { useState } from 'react'
import type { Asset, CaptionResult, Post, PostTarget } from '@shared/types'
import { formatDuration } from '@shared/formats'
import { api, fromLocalInput, mediaUrl, toLocalInput, useAction, useLoad, useToast, PLATFORM_LABEL } from '../lib'
import { TagInput } from './TagInput'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function PostEditor({ initial, onClose, onSaved }: { initial: Partial<Post>; onClose: () => void; onSaved: () => void }): React.JSX.Element {
  const toast = useToast()
  const [busy, run] = useAction()
  const [writing, runWrite] = useAction()
  const [post, setPost] = useState<Partial<Post>>({ caption: '', hashtags: [], targets: [], assetIds: [], notes: '', ...initial })
  const [picking, setPicking] = useState(false)
  const [captionPlatform, setCaptionPlatform] = useState('instagram')
  const [alternatives, setAlternatives] = useState<string[]>([])
  const presets = useLoad(() => api.listPresets())
  const settings = useLoad(() => api.getSettings())
  const sets = useLoad(() => api.listHashtagSets())
  const assets = useLoad(() => Promise.all((post.assetIds ?? []).map((id) => api.getAsset(id))), [JSON.stringify(post.assetIds)])
  const best = useLoad(() => api.bestTimes('instagram'))

  const set = (patch: Partial<Post>): void => setPost((p) => ({ ...p, ...patch }))
  const targets = post.targets ?? []
  const toggleTarget = (t: PostTarget): void => {
    const has = targets.some((x) => x.presetId === t.presetId)
    set({ targets: has ? targets.filter((x) => x.presetId !== t.presetId) : [...targets, t] })
  }

  const save = async (extra: Partial<Post> = {}): Promise<Post | undefined> => {
    const title = (post.title ?? '').trim() || 'Untitled post'
    const saved = await run(() => api.savePost({ ...post, ...extra, title }))
    if (saved) {
      setPost(saved)
      onSaved()
    }
    return saved
  }

  const writeCaption = async (): Promise<void> => {
    const r: CaptionResult | undefined = await runWrite(() =>
      api.writeCaption({ assetIds: post.assetIds ?? [], platform: PLATFORM_LABEL[captionPlatform] ?? captionPlatform, notes: post.notes, title: post.title })
    )
    if (r) {
      set({ caption: r.caption, hashtags: r.hashtags })
      setAlternatives(r.alternatives)
    }
  }

  const prepare = async (): Promise<void> => {
    const saved = await save()
    if (!saved) return
    const r = await run(() => api.preparePostFiles(saved.id))
    if (r) toast(r.queued ? `Making ${r.queued} file${r.queued === 1 ? '' : 's'}. Watch progress in Ready to post.` : 'All files are already ready.', 'success')
  }

  const kit = async (platform: string): Promise<void> => {
    const saved = await save()
    if (!saved) return
    const r = await run(() => api.openPublishKit(saved.id, platform))
    if (!r) return
    const parts = [r.copied ? 'Caption and hashtags copied. Paste them in the app.' : 'No caption yet.', r.folder ? 'Your files are open in a folder.' : '']
    if (r.missing.length) parts.push(`Still to export: ${r.missing.join(', ')}. Use "Prepare files".`)
    toast(parts.filter(Boolean).join(' '), r.missing.length ? 'error' : 'success')
  }

  const platforms = [...new Set(targets.map((t) => t.platform))]
  const byPlatform = new Map<string, NonNullable<typeof presets.data>>()
  for (const p of presets.data ?? []) byPlatform.set(p.platform, [...(byPlatform.get(p.platform) ?? []), p])
  const charCount = (post.caption ?? '').length + (post.hashtags ?? []).reduce((n, h) => n + h.length + 2, 0)

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="page-head">
          <input className="title-input" value={post.title ?? ''} placeholder="What's this post? e.g. Dubplate test at the studio" onChange={(e) => set({ title: e.target.value })} autoFocus={!post.id} />
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="editor-grid">
          <div>
            <h3>Media</h3>
            <div className="media-strip">
              {(assets.data ?? []).filter((a): a is Asset => !!a).map((a) => (
                <div key={a.id} className="media-item">
                  {a.thumbPath ? <img src={mediaUrl(a.thumbPath)} alt="" /> : <div className="thumb-placeholder">{a.kind}</div>}
                  {a.kind === 'video' && <span className="badge">{formatDuration(a.durationSec)}</span>}
                  <button className="remove" onClick={() => set({ assetIds: (post.assetIds ?? []).filter((x) => x !== a.id) })} aria-label="Remove">
                    ×
                  </button>
                </div>
              ))}
              <button className="media-add" onClick={() => setPicking(true)}>
                + Add from library
              </button>
            </div>

            <h3>Where is it going?</h3>
            <div className="targets">
              {[...byPlatform.entries()].map(([platform, list]) => (
                <div key={platform} className="target-group">
                  <strong>{list[0].platformName}</strong>
                  {list.map((p) => (
                    <label key={p.id} className="check small">
                      <input type="checkbox" checked={targets.some((t) => t.presetId === p.id)} onChange={() => toggleTarget({ platform, presetId: p.id })} />
                      {p.name}
                      {targets.find((t) => t.presetId === p.id)?.done && <span className="pill pill-posted">posted</span>}
                    </label>
                  ))}
                </div>
              ))}
            </div>

            <h3>Notes for yourself</h3>
            <textarea rows={4} value={post.notes ?? ''} placeholder="Hook, which part of the clip, the track ID, who to tag…" onChange={(e) => set({ notes: e.target.value })} />
          </div>

          <div>
            <div className="row space">
              <h3>Caption</h3>
              <div className="row">
                <select value={captionPlatform} onChange={(e) => setCaptionPlatform(e.target.value)}>
                  {['instagram', 'tiktok', 'youtube', 'facebook', 'x'].map((p) => (
                    <option key={p} value={p}>
                      for {PLATFORM_LABEL[p]}
                    </option>
                  ))}
                </select>
                <button className="btn btn-small btn-primary" disabled={writing || !settings.data?.hasClaudeKey} onClick={writeCaption} title={settings.data?.hasClaudeKey ? '' : 'Add a Claude API key in Settings'}>
                  {writing ? 'Writing…' : '✦ Write with Claude'}
                </button>
              </div>
            </div>
            <textarea rows={6} value={post.caption ?? ''} placeholder="Write a caption, or let Claude draft one from your clip and notes." onChange={(e) => set({ caption: e.target.value })} />
            <div className="muted small right">{charCount} / 2200 characters on Instagram</div>
            {alternatives.length > 0 && (
              <div className="alternatives">
                <span className="muted small">Other angles:</span>
                {alternatives.map((a, i) => (
                  <button key={i} className="alt" onClick={() => set({ caption: a })}>
                    {a}
                  </button>
                ))}
              </div>
            )}
            <h3>Hashtags</h3>
            <TagInput value={post.hashtags ?? []} onChange={(h) => set({ hashtags: h })} placeholder="dubstep, bassmusic…" prefix="#" />
            {(sets.data ?? []).length > 0 && (
              <div className="suggestions">
                {(sets.data ?? []).map((s) => (
                  <button key={s.id} className="chip chip-ghost" onClick={() => set({ hashtags: [...new Set([...(post.hashtags ?? []), ...s.tags])] })}>
                    + {s.name} set
                  </button>
                ))}
              </div>
            )}

            <h3>When</h3>
            <div className="row">
              <input type="datetime-local" value={toLocalInput(post.scheduledAt ?? null)} onChange={(e) => set({ scheduledAt: fromLocalInput(e.target.value) })} />
              <select value={post.pillar ?? ''} onChange={(e) => set({ pillar: e.target.value || null })}>
                <option value="">Content pillar…</option>
                {(settings.data?.pillars ?? []).map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
            {(best.data ?? []).length > 0 && (
              <p className="muted small">
                Your best Instagram slots so far:{' '}
                {(best.data ?? [])
                  .slice(0, 3)
                  .map((b) => `${WEEKDAYS[b.weekday]} ${String(b.hour).padStart(2, '0')}:00–${String(b.hour + 3).padStart(2, '0')}:00`)
                  .join(', ')}
              </p>
            )}
          </div>
        </div>

        <div className="modal-actions spread">
          <div className="row">
            {post.id && (
              <button
                className="btn btn-danger"
                onClick={() => {
                  if (confirm('Delete this post? Your files stay in the library.')) void run(() => api.deletePost(post.id!)).then(() => (onSaved(), onClose()))
                }}
              >
                Delete
              </button>
            )}
          </div>
          <div className="row wrap">
            <button className="btn" disabled={busy || !targets.length || !(post.assetIds ?? []).length} onClick={prepare}>
              Prepare files
            </button>
            {platforms.map((pl) => (
              <span key={pl} className="row">
                <button className="btn" disabled={busy} onClick={() => kit(pl)} title="Copies the caption and opens the files so you can upload in seconds">
                  Post to {PLATFORM_LABEL[pl] ?? pl}
                </button>
                {post.id && !targets.filter((t) => t.platform === pl).every((t) => t.done) && (
                  <button
                    className="btn btn-small"
                    onClick={() => void run(() => api.markPosted(post.id!, pl), `Marked as posted on ${PLATFORM_LABEL[pl] ?? pl}`).then((p) => p && (setPost(p), onSaved()))}
                  >
                    ✓ Done
                  </button>
                )}
              </span>
            ))}
            <button className="btn btn-primary" disabled={busy} onClick={() => save().then((p) => p && toast('Saved', 'success'))}>
              Save
            </button>
          </div>
        </div>
        {picking && (
          <AssetPicker
            selected={post.assetIds ?? []}
            onClose={() => setPicking(false)}
            onPick={(ids) => {
              set({ assetIds: ids })
              setPicking(false)
            }}
          />
        )}
      </div>
    </div>
  )
}

function AssetPicker({ selected, onPick, onClose }: { selected: number[]; onPick: (ids: number[]) => void; onClose: () => void }): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState<number[]>(selected)
  const assets = useLoad(() => api.listAssets({ search, limit: 300 }), [search])
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="page-head">
          <h2>Choose media</h2>
          <input className="search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="thumb-grid picker">
          {(assets.data ?? []).map((a) => (
            <button
              key={a.id}
              className={`thumb ${chosen.includes(a.id) ? 'selected' : ''}`}
              onClick={() => setChosen((c) => (c.includes(a.id) ? c.filter((x) => x !== a.id) : [...c, a.id]))}
            >
              {a.thumbPath ? <img src={mediaUrl(a.thumbPath)} alt="" loading="lazy" /> : <div className="thumb-placeholder">{a.kind}</div>}
              {a.kind === 'video' && (
                <div className="thumb-badges">
                  <span className="badge">{formatDuration(a.durationSec)}</span>
                </div>
              )}
              {a.tags.length > 0 && <div className="thumb-tags">{a.tags.slice(0, 3).join(' · ')}</div>}
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => onPick(chosen)}>
            Use {chosen.length} item{chosen.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  )
}
