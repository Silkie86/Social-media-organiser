import { useMemo } from 'react'
import { api, fmtDate, useCrateEvent, useLoad } from '../lib'

export function Ready(): React.JSX.Element {
  const jobs = useLoad(() => api.listExports())
  const presets = useLoad(() => api.listPresets())
  const settings = useLoad(() => api.getSettings())
  const ff = useLoad(() => api.ffmpegAvailable())
  useCrateEvent((e) => e.type === 'export-progress' && jobs.reload())
  const presetById = useMemo(() => new Map((presets.data ?? []).map((p) => [p.id, p])), [presets.data])
  const list = jobs.data ?? []
  const active = list.filter((j) => j.status === 'queued' || j.status === 'running')
  const done = list.filter((j) => j.status === 'done')
  const failed = list.filter((j) => j.status === 'error')

  return (
    <div className="page">
      <div className="page-head">
        <h1>Ready to post</h1>
        {settings.data && (
          <button className="btn" onClick={() => api.revealInFolder(`${settings.data!.libraryRoot}`)}>
            Open library folder
          </button>
        )}
      </div>
      {ff.data === false && <p className="error">The video converter (ffmpeg) is missing, so exports can't run. Reinstalling Crate should fix this.</p>}
      <p className="muted">Exported files go into the "Ready to Post" folder in your library, one folder per platform and format.</p>
      {active.length > 0 && (
        <section>
          <h2>Working on</h2>
          <div className="list">
            {active.map((j) => {
              const p = presetById.get(j.presetId)
              return (
                <div key={j.id} className="list-row">
                  <strong>
                    {p?.platformName} {p?.name}
                  </strong>
                  <div className="bar grow">
                    <div style={{ width: `${Math.round(j.progress * 100)}%` }} />
                  </div>
                  <span className="muted">{j.status === 'queued' ? 'Waiting' : `${Math.round(j.progress * 100)}%`}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}
      {failed.length > 0 && (
        <section>
          <h2 className="warn-text">Didn't work</h2>
          <div className="list">
            {failed.slice(0, 10).map((j) => {
              const p = presetById.get(j.presetId)
              return (
                <div key={j.id} className="list-row">
                  <strong>
                    {p?.platformName} {p?.name}
                  </strong>
                  <span className="error small ellipsis">{j.error}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}
      <section>
        <h2>Done</h2>
        {done.length ? (
          <div className="list">
            {done.map((j) => {
              const p = presetById.get(j.presetId)
              return (
                <div key={j.id} className="list-row">
                  <span className="pill pill-posted">{p?.platformName}</span>
                  <strong>{p?.name}</strong>
                  <span className="muted ellipsis">{j.path?.split(/[\\/]/).pop()}</span>
                  <span className="right muted">{fmtDate(j.createdAt, true)}</span>
                  <button className="link" onClick={() => api.revealInFolder(j.path!)}>
                    Show
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="empty">Nothing exported yet. Pick a clip in the Library and press "Vertical pack".</div>
        )}
      </section>
    </div>
  )
}
