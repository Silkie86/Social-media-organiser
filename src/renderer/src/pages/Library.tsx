import { useMemo, useState } from 'react'
import type { Asset, AssetStatus, LibraryFilter } from '@shared/types'
import { formatDuration } from '@shared/formats'
import { api, mediaUrl, useAction, useCrateEvent, useLoad, useNav } from '../lib'
import { AssetPanel } from '../components/AssetPanel'
import { TagInput } from '../components/TagInput'

export const SUGGESTED_TAGS = [
  'studio', 'live set', 'b2b', 'crowd', 'drop', 'decks', 'synth', 'gear', 'vinyl', 'talking to camera',
  'behind the scenes', 'new tune', 'unreleased', 'collab', 'travel', 'promo', 'b-roll', 'tutorial'
]

const STATUSES: { value: AssetStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All (not archived)' },
  { value: 'new', label: 'New' },
  { value: 'keeper', label: 'Keepers' },
  { value: 'edited', label: 'Edited' },
  { value: 'posted', label: 'Posted' },
  { value: 'archived', label: 'Archived' }
]

export function Library({ onImport }: { onImport: () => void }): React.JSX.Element {
  const nav = useNav()
  const [filter, setFilter] = useState<LibraryFilter>({ kind: 'all', status: 'all' })
  const [selected, setSelected] = useState<number[]>([])
  const [anchor, setAnchor] = useState<number | null>(null)
  const assets = useLoad(() => api.listAssets(filter), [JSON.stringify(filter)])
  const tags = useLoad(() => api.listTags())
  const shoots = useLoad(() => api.listShoots())
  const [, run] = useAction()

  useCrateEvent((e) => {
    if (e.type === 'library-changed') {
      assets.reload()
      shoots.reload()
    }
  })

  const list = assets.data ?? []
  const byDay = useMemo(() => {
    const groups: { day: string; items: Asset[] }[] = []
    for (const a of list) {
      const day = new Date(a.capturedAt).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      const last = groups[groups.length - 1]
      if (last?.day === day) last.items.push(a)
      else groups.push({ day, items: [a] })
    }
    return groups
  }, [list])

  const click = (e: React.MouseEvent, id: number): void => {
    if (e.shiftKey && anchor != null) {
      const ids = list.map((a) => a.id)
      const [a, b] = [ids.indexOf(anchor), ids.indexOf(id)].sort((x, y) => x - y)
      setSelected(ids.slice(a, b + 1))
    } else if (e.ctrlKey || e.metaKey) {
      setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
      setAnchor(id)
    } else {
      setSelected([id])
      setAnchor(id)
    }
  }

  const refresh = (): void => {
    assets.reload()
    tags.reload()
  }
  const single = selected.length === 1 ? list.find((a) => a.id === selected[0]) : undefined

  return (
    <div className="library">
      <div className="library-main">
        <div className="toolbar">
          <input className="search" placeholder="Search names, tags, notes, shoots…" value={filter.search ?? ''} onChange={(e) => setFilter({ ...filter, search: e.target.value })} />
          <select value={filter.kind} onChange={(e) => setFilter({ ...filter, kind: e.target.value as LibraryFilter['kind'] })}>
            <option value="all">Everything</option>
            <option value="video">Videos</option>
            <option value="photo">Photos</option>
            <option value="raw">RAW only</option>
            <option value="audio">Audio</option>
          </select>
          <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value as LibraryFilter['status'] })}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select value={filter.tag ?? ''} onChange={(e) => setFilter({ ...filter, tag: e.target.value || undefined })}>
            <option value="">Any tag</option>
            {(tags.data ?? []).map((t) => (
              <option key={t.tag} value={t.tag}>
                {t.tag} ({t.count})
              </option>
            ))}
          </select>
          <select value={filter.shootId ?? ''} onChange={(e) => setFilter({ ...filter, shootId: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Any shoot</option>
            {(shoots.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.assetCount})
              </option>
            ))}
          </select>
          <select value={filter.minRating ?? 0} onChange={(e) => setFilter({ ...filter, minRating: Number(e.target.value) || undefined })}>
            <option value={0}>Any rating</option>
            {[1, 2, 3, 4, 5].map((r) => (
              <option key={r} value={r}>
                {'★'.repeat(r)} and up
              </option>
            ))}
          </select>
          <label className="check small">
            <input type="checkbox" checked={!!filter.onlyLog} onChange={(e) => setFilter({ ...filter, onlyLog: e.target.checked || undefined })} /> S-Log only
          </label>
        </div>

        {selected.length > 1 && (
          <BulkBar
            ids={selected}
            onDone={refresh}
            onClear={() => setSelected([])}
            onPost={() => nav.go('planner', { id: -1, assetIds: selected })}
            run={run}
          />
        )}

        {assets.error && <p className="error">{assets.error}</p>}
        {!assets.loading && list.length === 0 && (
          <div className="empty big">
            <p>{filter.search || filter.tag || filter.shootId ? 'Nothing matches those filters.' : 'Your library is empty.'}</p>
            <button className="btn btn-primary" onClick={onImport}>
              Import footage
            </button>
            <p className="muted">Plug in your camera's SD card and Crate will offer to import it automatically.</p>
          </div>
        )}
        <div className="scroll">
          {byDay.map((g) => (
            <section key={g.day}>
              <h3 className="day-head">
                {g.day} <span className="muted">· {g.items.length}</span>
              </h3>
              <div className="thumb-grid">
                {g.items.map((a) => (
                  <button key={a.id} className={`thumb ${selected.includes(a.id) ? 'selected' : ''}`} onClick={(e) => click(e, a.id)} title={a.originalName}>
                    {a.thumbPath ? <img src={mediaUrl(a.thumbPath)} alt="" loading="lazy" /> : <div className="thumb-placeholder">{a.kind.toUpperCase()}</div>}
                    <div className="thumb-badges">
                      {a.kind === 'video' && <span className="badge">{formatDuration(a.durationSec)}</span>}
                      {a.isLog && <span className="badge badge-log">LOG</span>}
                      {a.pairedRawPath && <span className="badge">+RAW</span>}
                      {a.status === 'posted' && <span className="badge badge-ok">Posted</span>}
                    </div>
                    {a.rating > 0 && <div className="thumb-rating">{'★'.repeat(a.rating)}</div>}
                    {a.tags.length > 0 && <div className="thumb-tags">{a.tags.slice(0, 3).join(' · ')}</div>}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
      <div className="side-panel">
        {single ? (
          <AssetPanel key={single.id} asset={single} allTags={(tags.data ?? []).map((t) => t.tag)} onChanged={refresh} />
        ) : (
          <div className="empty">
            <p>Select a clip or photo to see it, tag it and make it ready for any platform.</p>
            <p className="muted">Tip: Ctrl-click or Shift-click to select several and tag them all at once.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function BulkBar({
  ids,
  onDone,
  onClear,
  onPost,
  run
}: {
  ids: number[]
  onDone: () => void
  onClear: () => void
  onPost: () => void
  run: ReturnType<typeof useAction>[1]
}): React.JSX.Element {
  const [tags, setTags] = useState<string[]>([])
  return (
    <div className="bulk-bar">
      <strong>{ids.length} selected</strong>
      <div className="bulk-tags">
        <TagInput value={tags} onChange={setTags} placeholder="Add tags to all…" />
      </div>
      <button
        className="btn"
        disabled={!tags.length}
        onClick={() => run(() => api.setAssetTags(ids, tags, 'add'), `Tagged ${ids.length} items`).then(() => (setTags([]), onDone()))}
      >
        Add tags
      </button>
      <select
        value=""
        onChange={(e) => {
          const status = e.target.value as AssetStatus
          if (status) void run(() => Promise.all(ids.map((id) => api.updateAsset(id, { status }))), 'Updated').then(onDone)
        }}
      >
        <option value="">Set status…</option>
        <option value="keeper">Keeper</option>
        <option value="edited">Edited</option>
        <option value="posted">Posted</option>
        <option value="archived">Archive</option>
      </select>
      <button className="btn btn-primary" onClick={onPost}>
        Make a post with these
      </button>
      <button className="btn btn-ghost" onClick={onClear}>
        Clear
      </button>
    </div>
  )
}
