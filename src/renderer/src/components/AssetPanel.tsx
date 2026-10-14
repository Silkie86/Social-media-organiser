import { useEffect, useState } from 'react'
import type { Asset, AssetStatus, ExportJob, ExportOptions, FitMode } from '@shared/types'
import { formatDuration, type FormatPreset } from '@shared/formats'
import { api, fmtDate, fmtSize, mediaUrl, useAction, useCrateEvent, useLoad, useNav } from '../lib'
import { TagInput } from './TagInput'
import { SUGGESTED_TAGS } from '../pages/Library'

const VERTICAL_PACK = ['ig-reel', 'tiktok', 'yt-short', 'fb-reel']

export function AssetPanel({ asset, allTags, onChanged }: { asset: Asset; allTags: string[]; onChanged: () => void }): React.JSX.Element {
  const nav = useNav()
  const [busy, run] = useAction()
  const [notes, setNotes] = useState(asset.notes)
  const presets = useLoad(() => api.listPresets())
  const readiness = useLoad(() => api.checkReadiness(asset.id), [asset.id, asset.isLog])
  const settings = useLoad(() => api.getSettings())
  const [jobs, setJobs] = useState<ExportJob[]>([])
  const [chosen, setChosen] = useState<string[]>([])
  const [opts, setOpts] = useState<Partial<ExportOptions>>({ start: 0, normaliseAudio: true, applyLut: asset.isLog })
  const [fit, setFit] = useState<FitMode | ''>('')

  useEffect(() => {
    void api.listExports(asset.id).then(setJobs)
  }, [asset.id])
  useCrateEvent((e) => {
    if (e.type === 'export-progress' && e.payload.assetId === asset.id) {
      setJobs((js) => [e.payload, ...js.filter((j) => j.id !== e.payload.id)].sort((a, b) => b.id - a.id))
    }
  })

  const update = (patch: { rating?: number; status?: AssetStatus; notes?: string; isLog?: boolean }): void => {
    void run(() => api.updateAsset(asset.id, patch)).then(onChanged)
  }

  const isMedia = asset.kind === 'video' || asset.kind === 'photo'
  const presetById = new Map((presets.data ?? []).map((p) => [p.id, p]))
  const usable = (readiness.data ?? []).filter((r) => r.verdict !== 'unsupported')
  const exportable = usable.filter((r) => r.verdict === 'export').map((r) => r.presetId)

  const startExport = async (ids: string[]): Promise<void> => {
    if (!ids.length) return
    const queued = await run(() => api.queueExports(asset.id, ids, { ...opts, ...(fit ? { fitMode: fit } : {}) }), `Making ${ids.length} file${ids.length === 1 ? '' : 's'}…`)
    if (queued) setChosen([])
  }

  return (
    <div className="asset-panel">
      <div className="preview">
        {asset.kind === 'video' ? (
          <video src={mediaUrl(asset.path)} poster={mediaUrl(asset.thumbPath)} controls preload="metadata" />
        ) : asset.kind === 'photo' ? (
          <img src={mediaUrl(asset.path)} alt="" />
        ) : (
          <div className="thumb-placeholder tall">{asset.kind.toUpperCase()}</div>
        )}
      </div>
      <h3 className="ellipsis" title={asset.path}>
        {asset.originalName}
      </h3>
      <div className="meta">
        <span>{fmtDate(asset.capturedAt, true)}</span>
        {asset.durationSec != null && <span>{formatDuration(asset.durationSec)}</span>}
        {asset.width && (
          <span>
            {asset.width}×{asset.height}
          </span>
        )}
        {asset.fps && <span>{asset.fps} fps</span>}
        {asset.codec && <span>{asset.codec.toUpperCase()}</span>}
        <span>{fmtSize(asset.size)}</span>
        {asset.camera && <span>{asset.camera}</span>}
      </div>
      <div className="row">
        <div className="stars">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className={n <= asset.rating ? 'on' : ''} onClick={() => update({ rating: n === asset.rating ? 0 : n })} aria-label={`${n} stars`}>
              ★
            </button>
          ))}
        </div>
        <select value={asset.status} onChange={(e) => update({ status: e.target.value as AssetStatus })}>
          <option value="new">New</option>
          <option value="keeper">Keeper</option>
          <option value="edited">Edited</option>
          <option value="posted">Posted</option>
          <option value="archived">Archived</option>
        </select>
        <button className="btn btn-small" onClick={() => api.revealInFolder(asset.path)}>
          Show file
        </button>
      </div>
      <label className="field">
        <span>Tags</span>
        <TagInput value={asset.tags} suggestions={[...new Set([...SUGGESTED_TAGS, ...allTags])]} onChange={(t) => void run(() => api.setAssetTags([asset.id], t, 'replace')).then(onChanged)} />
      </label>
      <label className="field">
        <span>Notes (what happens, best moment, track playing…)</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== asset.notes && update({ notes })} />
      </label>
      {asset.kind === 'video' && (
        <label className="check small">
          <input type="checkbox" checked={asset.isLog} onChange={(e) => update({ isLog: e.target.checked })} /> Shot in S-Log (flat colour, needs a LUT)
        </label>
      )}

      {isMedia && (
        <section className="formats">
          <h3>Make it ready to post</h3>
          <div className="row wrap">
            {asset.kind === 'video' && (
              <button className="btn btn-small" disabled={busy} onClick={() => startExport(VERTICAL_PACK.filter((id) => usable.some((r) => r.presetId === id)))}>
                Vertical pack (Reels, TikTok, Shorts, FB)
              </button>
            )}
            <button className="btn btn-small" disabled={busy || !exportable.length} onClick={() => startExport(exportable)}>
              Everything that needs it ({exportable.length})
            </button>
          </div>
          <div className="preset-list">
            {usable.map((r) => {
              const p = presetById.get(r.presetId) as FormatPreset | undefined
              if (!p) return null
              const done = jobs.find((j) => j.presetId === p.id && j.status === 'done')
              return (
                <label key={p.id} className={`preset ${r.verdict}`}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(p.id)}
                    onChange={(e) => setChosen((c) => (e.target.checked ? [...c, p.id] : c.filter((x) => x !== p.id)))}
                  />
                  <div>
                    <div>
                      <strong>{p.platformName}</strong> {p.name}{' '}
                      <span className={`pill ${r.verdict === 'ready' ? 'pill-posted' : 'pill-draft'}`}>{r.verdict === 'ready' ? 'Ready as-is' : 'Needs export'}</span>
                      {done && <span className="pill pill-posted">Exported</span>}
                    </div>
                    <ul className="issues">
                      {r.issues
                        .filter((i) => i.level !== 'ok')
                        .map((i, n) => (
                          <li key={n}>{i.message}</li>
                        ))}
                    </ul>
                  </div>
                </label>
              )
            })}
          </div>
          {asset.kind === 'video' && (
            <details className="export-options">
              <summary>Export options</summary>
              <div className="grid-2">
                <label className="field">
                  <span>Start at (seconds)</span>
                  <input type="number" min={0} step={0.5} value={opts.start ?? 0} onChange={(e) => setOpts({ ...opts, start: Number(e.target.value) })} />
                </label>
                <label className="field">
                  <span>Length (seconds, blank = as long as allowed)</span>
                  <input
                    type="number"
                    min={1}
                    step={0.5}
                    value={opts.duration ?? ''}
                    onChange={(e) => setOpts({ ...opts, duration: e.target.value ? Number(e.target.value) : undefined })}
                  />
                </label>
                <label className="field">
                  <span>Shape</span>
                  <select value={fit} onChange={(e) => setFit(e.target.value as FitMode | '')}>
                    <option value="">Best for each format</option>
                    <option value="fill">Crop to fill</option>
                    <option value="blur">Fit, blurred background</option>
                    <option value="fit">Fit, black bars</option>
                  </select>
                </label>
                <label className="field">
                  <span>Crop position</span>
                  <input type="range" min={-1} max={1} step={0.1} value={opts.cropX ?? 0} onChange={(e) => setOpts({ ...opts, cropX: Number(e.target.value) })} />
                </label>
              </div>
              <label className="field">
                <span>Text on screen (optional)</span>
                <input value={opts.overlayText ?? ''} placeholder="e.g. NEW TUNE OUT FRIDAY" onChange={(e) => setOpts({ ...opts, overlayText: e.target.value })} />
              </label>
              <label className="check small">
                <input type="checkbox" checked={!!opts.normaliseAudio} onChange={(e) => setOpts({ ...opts, normaliseAudio: e.target.checked })} /> Even out loudness (−14 LUFS,
                what the apps use)
              </label>
              <label className="check small">
                <input type="checkbox" checked={!!opts.applyLut} onChange={(e) => setOpts({ ...opts, applyLut: e.target.checked })} /> Apply my LUT{' '}
                {settings.data?.lutPath ? '' : '(set one in Settings first)'}
              </label>
            </details>
          )}
          <button className="btn btn-primary wide" disabled={busy || !chosen.length} onClick={() => startExport(chosen)}>
            Export {chosen.length || ''} selected
          </button>
        </section>
      )}

      {jobs.length > 0 && (
        <section>
          <h3>Exports</h3>
          <div className="jobs">
            {jobs.slice(0, 12).map((j) => {
              const p = presetById.get(j.presetId)
              return (
                <div key={j.id} className="job">
                  <span>
                    {p?.platformName} {p?.name}
                  </span>
                  {j.status === 'running' || j.status === 'queued' ? (
                    <div className="bar small">
                      <div style={{ width: `${Math.round(j.progress * 100)}%` }} />
                    </div>
                  ) : j.status === 'done' && j.path ? (
                    <button className="link" onClick={() => api.revealInFolder(j.path!)}>
                      Show file
                    </button>
                  ) : (
                    <span className="error small" title={j.error ?? ''}>
                      Failed
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      <button className="btn wide" onClick={() => nav.go('planner', { id: -1, assetIds: [asset.id] })}>
        Make a post with this
      </button>
    </div>
  )
}
