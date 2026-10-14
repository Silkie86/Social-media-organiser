import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { CrateEvent } from '@shared/api'

export const api = window.crate

export function mediaUrl(p: string | null | undefined): string | undefined {
  return p ? `crate-media://local/${encodeURIComponent(p)}` : undefined
}

/** Loads data with an async function and reloads when deps change or reload() is called. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): { data: T | undefined; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => {
    let alive = true
    setLoading(true)
    fnRef
      .current()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [...deps, tick])
  return { data, error, loading, reload: useCallback(() => setTick((t) => t + 1), []) }
}

export function useCrateEvent(listener: (e: CrateEvent) => void): void {
  const ref = useRef(listener)
  ref.current = listener
  useEffect(() => window.crateEvents.on((e) => ref.current(e)), [])
}

// ---- toasts ----

interface Toast {
  id: number
  text: string
  kind: 'info' | 'error' | 'success'
}

const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {})

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = (): ((text: string, kind?: Toast['kind']) => void) => useContext(ToastCtx)

/** Wraps an async action with error toasts and a busy flag. */
export function useAction(): [boolean, <T>(fn: () => Promise<T>, success?: string) => Promise<T | undefined>] {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(true)
      try {
        const r = await fn()
        if (success) toast(success, 'success')
        return r
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error')
        return undefined
      } finally {
        setBusy(false)
      }
    },
    [toast]
  )
  return [busy, run]
}

// ---- formatting ----

export function fmtDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '–'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) })
}

export function fmtSize(bytes: number): string {
  if (bytes > 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes > 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** Value for <input type="datetime-local"> from an ISO string, in local time. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null
}

export const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  facebook: 'Facebook',
  x: 'X',
  spotify: 'Spotify',
  soundcloud: 'SoundCloud'
}

export type Page = 'today' | 'library' | 'planner' | 'ideas' | 'ready' | 'accounts' | 'settings'
export interface Nav {
  go: (page: Page, opts?: { id?: number; assetIds?: number[] }) => void
}
export const NavCtx = createContext<Nav>({ go: () => {} })
export const useNav = (): Nav => useContext(NavCtx)
