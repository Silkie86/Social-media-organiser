// Implements every CrateApi method the UI can call. Each one is a thin layer over the
// services; business logic lives in the services, not here.

import path from 'node:path'
import fs from 'node:fs'
import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { API_METHODS, type CrateApi } from '@shared/api'
import { PRESETS, checkReadiness, getPreset } from '@shared/formats'
import type { PlatformAccount, PlatformInfo } from '@shared/types'
import type { Services } from './services'
import { ContentAI } from './ai/claude'
import { getPlatform, PLATFORMS } from './platforms/registry'
import type { PlatformCredentials } from './platforms/types'
import { ffmpegPath } from './export/ffmpeg'
import { json } from './db'

export function createApi(s: Services, win: () => BrowserWindow | null): CrateApi {
  const { db, settings, library, exporter, planner, ai } = s

  const readAccount = (id: string): PlatformAccount | null => {
    const row = db.get('SELECT data FROM accounts WHERE platform = ?', [id])
    return row ? json<PlatformAccount | null>(row.data, null) : null
  }
  const readCreds = (id: string): PlatformCredentials | null => {
    const raw = settings.getSecret(`platform:${id}`)
    return raw ? json<PlatformCredentials | null>(raw, null) : null
  }
  const storeConnection = (id: string, account: PlatformAccount, creds: PlatformCredentials): void => {
    settings.setSecret(`platform:${id}`, JSON.stringify(creds))
    db.run('INSERT INTO accounts (platform, data, connected_at) VALUES (?, ?, ?) ON CONFLICT(platform) DO UPDATE SET data = excluded.data', [
      id,
      JSON.stringify(account),
      account.connectedAt
    ])
  }
  const platformInfo = (id: string): PlatformInfo => {
    const p = getPlatform(id)
    if (!p) throw new Error(`Unknown platform ${id}`)
    const account = readAccount(id)
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      connected: Boolean(account && settings.hasSecret(`platform:${id}`)),
      account,
      capabilities: p.capabilities,
      connectHelp: p.connectHelp,
      connectFields: p.connectFields
    }
  }

  const api: CrateApi = {
    // ---- settings ----
    getSettings: async () => settings.get(),
    updateSettings: async (patch) => {
      const next = settings.update(patch)
      s.onSettingsChanged(next)
      return next
    },
    setClaudeKey: async (key) => {
      const trimmed = key.trim()
      if (!trimmed) {
        settings.setSecret('claude', null)
        return { ok: true }
      }
      const check = await ContentAI.verifyKey(trimmed)
      if (check.ok) settings.setSecret('claude', trimmed)
      return check
    },
    pickFolder: async (title) => {
      const w = win()
      const opts: Electron.OpenDialogOptions = { title: title ?? 'Choose a folder', properties: ['openDirectory', 'createDirectory'] }
      const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
      return r.canceled ? null : (r.filePaths[0] ?? null)
    },
    pickFile: async (title, extensions) => {
      const w = win()
      const opts: Electron.OpenDialogOptions = { title, properties: ['openFile'], filters: [{ name: extensions.join(', '), extensions }] }
      const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
      return r.canceled ? null : (r.filePaths[0] ?? null)
    },
    openExternal: async (url) => {
      if (/^https:\/\//.test(url)) await shell.openExternal(url)
    },
    revealInFolder: async (p) => {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) await shell.openPath(p)
      else shell.showItemInFolder(p)
    },
    copyText: async (text) => clipboard.writeText(text),

    // ---- library ----
    listAssets: async (filter) => library.list(filter),
    getAsset: async (id) => library.get(id),
    updateAsset: async (id, patch) => library.update(id, patch),
    setAssetTags: async (ids, tags, mode) => library.setTags(ids, tags, mode),
    removeAssets: async (ids) => library.remove(ids),
    listTags: async () => library.listTags(),
    listShoots: async () => library.listShoots(),
    renameShoot: async (id, name) => library.renameShoot(id, name),
    detectCards: async () => library.detectCards(),
    importFrom: async (source, options) => {
      const from = source ?? (await api.pickFolder('Choose a folder or memory card to import from'))
      if (!from) return null
      fs.mkdirSync(settings.get().libraryRoot, { recursive: true })
      return { jobId: library.startImport(from, options) }
    },

    // ---- export ----
    listPresets: async () => PRESETS,
    checkReadiness: async (assetId) => {
      const asset = library.get(assetId)
      return asset ? PRESETS.map((p) => checkReadiness(asset, p)) : []
    },
    queueExports: async (assetId, presetIds, options) => exporter.enqueue(assetId, presetIds, options),
    listExports: async (assetId) => exporter.list(assetId),
    ffmpegAvailable: async () => ffmpegPath() !== null,

    // ---- posts ----
    listPosts: async (range) => planner.listPosts(range),
    savePost: async (post) => planner.savePost(post),
    deletePost: async (id) => planner.deletePost(id),
    markPosted: async (id, platform) => planner.markPosted(id, platform),
    preparePostFiles: async (id) => {
      const post = planner.getPost(id)
      if (!post) throw new Error('Post not found')
      let queued = 0
      for (const assetId of post.assetIds) {
        const asset = library.get(assetId)
        if (!asset) continue
        const done = exporter.doneFor(assetId)
        const pending = new Set(exporter.list(assetId).filter((j) => j.status === 'queued' || j.status === 'running').map((j) => j.presetId))
        const needed = post.targets
          .map((t) => t.presetId)
          .filter((pid) => {
            const preset = getPreset(pid)
            if (!preset || done.has(pid) || pending.has(pid)) return false
            return checkReadiness(asset, preset).verdict === 'export'
          })
        if (needed.length) queued += exporter.enqueue(assetId, [...new Set(needed)], {}).length
      }
      return { queued }
    },
    openPublishKit: async (id, platform) => {
      const post = planner.getPost(id)
      if (!post) throw new Error('Post not found')
      const tags = post.hashtags.length ? '\n\n' + post.hashtags.map((h) => `#${h}`).join(' ') : ''
      const text = `${post.caption}${tags}`.trim()
      if (text) clipboard.writeText(text)
      const presetIds = post.targets.filter((t) => t.platform === platform).map((t) => t.presetId)
      const files: string[] = []
      const missing: string[] = []
      for (const assetId of post.assetIds) {
        const asset = library.get(assetId)
        if (!asset) continue
        const done = exporter.doneFor(assetId)
        for (const pid of presetIds) {
          const preset = getPreset(pid)
          if (!preset) continue
          const exported = done.get(pid)
          if (exported) files.push(exported)
          else if (checkReadiness(asset, preset).verdict === 'ready') files.push(asset.path)
          else missing.push(`${asset.originalName} (${preset.platformName} ${preset.name})`)
        }
      }
      if (files[0]) shell.showItemInFolder(files[0])
      return { copied: Boolean(text), folder: files[0] ? path.dirname(files[0]) : null, missing }
    },
    dashboard: async () => planner.dashboard(settings.get().weeklyPostGoal),

    // ---- ideas & AI ----
    listIdeas: async (status) => planner.listIdeas(status),
    generateIdeas: async (req) => {
      const current = settings.get()
      const drafts = await ai.ideas(
        current,
        { ...req, count: Math.max(1, Math.min(15, req.count)) },
        library.list({ limit: 40 }),
        planner.listPosts().slice(0, 15),
        library.listTags()
      )
      return planner.addIdeas(drafts)
    },
    updateIdea: async (id, patch) => planner.updateIdea(id, patch),
    ideaToPost: async (id) => planner.ideaToPost(id),
    writeCaption: async (req) => ai.caption(settings.get(), req.platform, library.getMany(req.assetIds), { title: req.title, notes: req.notes }),
    listHashtagSets: async () => planner.listHashtagSets(),
    saveHashtagSet: async (set) => planner.saveHashtagSet(set),
    deleteHashtagSet: async (id) => planner.deleteHashtagSet(id),

    // ---- platforms ----
    listPlatforms: async () => PLATFORMS.map((p) => platformInfo(p.id)),
    connectPlatform: async (id, fields) => {
      const p = getPlatform(id)
      if (!p) throw new Error(`Unknown platform ${id}`)
      const { account, credentials } = await p.connect(fields)
      storeConnection(id, account, credentials)
      return platformInfo(id)
    },
    disconnectPlatform: async (id) => {
      settings.setSecret(`platform:${id}`, null)
      db.run('DELETE FROM accounts WHERE platform = ?', [id])
    },
    platformMedia: async (id) => {
      const p = getPlatform(id)
      const creds = readCreds(id)
      const account = readAccount(id)
      if (!p?.recentMedia || !creds || !account) return planner.cachedMedia(id)
      try {
        let current = creds
        if (p.refresh) {
          const refreshed = await p.refresh(creds, account)
          storeConnection(id, refreshed.account, refreshed.credentials)
          current = refreshed.credentials
        }
        const media = await p.recentMedia(current)
        planner.cacheMedia(id, media)
        return media
      } catch (err) {
        const cached = planner.cachedMedia(id)
        if (cached.length) return cached
        throw err
      }
    },
    bestTimes: async (id) => planner.bestTimes(id)
  }
  return api
}

/** Registers every API method as an IPC handler. Errors are passed back as messages. */
export function registerIpc(api: CrateApi): void {
  for (const name of API_METHODS) {
    ipcMain.handle(`crate:${name}`, async (_e, ...args: unknown[]) => {
      try {
        const fn = api[name] as (...a: unknown[]) => Promise<unknown>
        return { ok: true, value: await fn(...args) }
      } catch (err) {
        console.error(`[crate:${name}]`, err)
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    })
  }
}

