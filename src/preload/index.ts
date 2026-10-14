import { contextBridge, ipcRenderer } from 'electron'
import { API_METHODS, type CrateApi, type CrateEvent } from '@shared/api'

const api = {} as Record<string, (...args: unknown[]) => Promise<unknown>>
for (const name of API_METHODS) {
  api[name] = async (...args: unknown[]) => {
    const res = (await ipcRenderer.invoke(`crate:${name}`, ...args)) as { ok: boolean; value?: unknown; error?: string }
    if (!res.ok) throw new Error(res.error ?? 'Something went wrong')
    return res.value
  }
}

contextBridge.exposeInMainWorld('crate', api as unknown as CrateApi)
contextBridge.exposeInMainWorld('crateEvents', {
  on(listener: (event: CrateEvent) => void): () => void {
    const handler = (_e: unknown, event: CrateEvent): void => listener(event)
    ipcRenderer.on('crate:event', handler)
    return () => ipcRenderer.removeListener('crate:event', handler)
  }
})
