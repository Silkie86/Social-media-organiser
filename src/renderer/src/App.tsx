import { useEffect, useState } from 'react'
import type { CameraCard, ImportProgress } from '@shared/types'
import { api, NavCtx, ToastProvider, useCrateEvent, useLoad, useToast, type Page } from './lib'
import { Today } from './pages/Today'
import { Library } from './pages/Library'
import { Planner } from './pages/Planner'
import { Ideas } from './pages/Ideas'
import { Ready } from './pages/Ready'
import { Accounts } from './pages/Accounts'
import { SettingsPage } from './pages/Settings'
import { Onboarding } from './pages/Onboarding'
import { ImportDialog } from './components/ImportDialog'

const NAV: { page: Page; label: string; icon: string }[] = [
  { page: 'today', label: 'Today', icon: '◉' },
  { page: 'library', label: 'Library', icon: '▦' },
  { page: 'planner', label: 'Planner', icon: '▤' },
  { page: 'ideas', label: 'Ideas', icon: '✦' },
  { page: 'ready', label: 'Ready to post', icon: '⇪' },
  { page: 'accounts', label: 'Accounts', icon: '◎' },
  { page: 'settings', label: 'Settings', icon: '⚙' }
]

export function App(): React.JSX.Element {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  )
}

function Shell(): React.JSX.Element {
  const toast = useToast()
  const settings = useLoad(() => api.getSettings())
  const [page, setPage] = useState<Page>('today')
  const [params, setParams] = useState<{ id?: number; assetIds?: number[] }>({})
  const [card, setCard] = useState<CameraCard | null>(null)
  const [importSource, setImportSource] = useState<string | null | undefined>(undefined)
  const [progress, setProgress] = useState<ImportProgress | null>(null)

  const go = (p: Page, opts: { id?: number; assetIds?: number[] } = {}): void => {
    setParams(opts)
    setPage(p)
  }

  useCrateEvent((e) => {
    if (e.type === 'card-detected') setCard(e.payload)
    if (e.type === 'navigate') go(e.payload.page as Page, { id: e.payload.id })
    if (e.type === 'import-progress') {
      setProgress(e.payload)
      if (e.payload.phase === 'done') {
        toast(`Imported ${e.payload.imported ?? 0} new file${e.payload.imported === 1 ? '' : 's'}${e.payload.skipped ? `, skipped ${e.payload.skipped} already in your library` : ''}.`, 'success')
        setTimeout(() => setProgress(null), 1500)
      }
      if (e.payload.phase === 'error') {
        toast(`Import stopped: ${e.payload.error}`, 'error')
        setProgress(null)
      }
    }
  })

  // Check for a card already plugged in when the app opens.
  useEffect(() => {
    api.detectCards().then((cards) => {
      const withNew = cards.find((c) => c.newCount > 0)
      if (withNew) setCard(withNew)
    }, () => {})
  }, [])

  if (settings.loading && !settings.data) return <div className="splash">Loading…</div>
  if (settings.data && !settings.data.onboarded) return <Onboarding initial={settings.data} onDone={settings.reload} />

  return (
    <NavCtx.Provider value={{ go }}>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark">▮▮▮</span> Crate
          </div>
          {NAV.map((n) => (
            <button key={n.page} className={`nav-item ${page === n.page ? 'active' : ''}`} onClick={() => go(n.page)}>
              <span className="nav-icon">{n.icon}</span>
              {n.label}
            </button>
          ))}
          <div className="sidebar-foot">
            <button className="btn btn-primary wide" onClick={() => setImportSource(null)}>
              Import footage
            </button>
          </div>
        </aside>
        <main className="content">
          {card && (
            <div className="banner">
              <div>
                <strong>{card.camera} card found</strong> on {card.label}: {card.newCount} new file{card.newCount === 1 ? '' : 's'} ({card.videoCount} videos,{' '}
                {card.photoCount} photos on the card).
              </div>
              <div className="row">
                <button className="btn btn-primary" onClick={() => (setImportSource(card.root), setCard(null))}>
                  Import now
                </button>
                <button className="btn" onClick={() => setCard(null)}>
                  Not now
                </button>
              </div>
            </div>
          )}
          {progress && progress.phase !== 'error' && (
            <div className="import-progress">
              <span>
                {progress.phase === 'scanning' && 'Looking for files…'}
                {progress.phase === 'copying' && `Copying ${progress.current} of ${progress.total}: ${progress.file ?? ''}`}
                {progress.phase === 'analysing' && `Making previews ${progress.current} of ${progress.total}`}
                {progress.phase === 'done' && 'Import finished'}
              </span>
              <div className="bar">
                <div style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 5}%` }} />
              </div>
            </div>
          )}
          {page === 'today' && <Today onImport={() => setImportSource(null)} />}
          {page === 'library' && <Library onImport={() => setImportSource(null)} />}
          {page === 'planner' && <Planner openId={params.id} newWithAssets={params.assetIds} />}
          {page === 'ideas' && <Ideas />}
          {page === 'ready' && <Ready />}
          {page === 'accounts' && <Accounts />}
          {page === 'settings' && <SettingsPage onSaved={settings.reload} />}
        </main>
      </div>
      {importSource !== undefined && <ImportDialog source={importSource} onClose={() => setImportSource(undefined)} />}
    </NavCtx.Provider>
  )
}
