// The footage library: importing from cards and folders, organising into dated shoot
// folders, tagging, rating, and finding things again.

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Asset, AssetStatus, CameraCard, ImportOptions, ImportProgress, LibraryFilter, Shoot } from '@shared/types'
import type { Db, Row } from '../db'
import { candidateVolumes, detectCardLayout, kindForFile, readSonyMeta, walkMedia } from './camera'
import { makeThumbnail, probe } from '../export/ffmpeg'

const KIND_FOLDER: Record<string, string> = { video: 'Video', photo: 'Photos', raw: 'RAW', audio: 'Audio' }

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function localDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function localStamp(iso: string): string {
  const d = new Date(iso)
  return `${localDate(iso)}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function safeName(s: string): string {
  return s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)
}

export class Library {
  constructor(
    private readonly db: Db,
    private readonly thumbsDir: string,
    private readonly getLibraryRoot: () => string,
    private readonly emit: (progress: ImportProgress) => void,
    private readonly onChanged: () => void
  ) {
    fs.mkdirSync(thumbsDir, { recursive: true })
  }

  // ---- reading ----

  private toAsset(r: Row, tags: string[]): Asset {
    return {
      id: Number(r.id),
      path: String(r.path),
      kind: r.kind as Asset['kind'],
      originalName: String(r.original_name),
      size: Number(r.size),
      capturedAt: String(r.captured_at),
      importedAt: String(r.imported_at),
      durationSec: r.duration_sec == null ? null : Number(r.duration_sec),
      width: r.width == null ? null : Number(r.width),
      height: r.height == null ? null : Number(r.height),
      fps: r.fps == null ? null : Number(r.fps),
      codec: r.codec == null ? null : String(r.codec),
      camera: r.camera == null ? null : String(r.camera),
      isLog: Boolean(r.is_log),
      shootId: r.shoot_id == null ? null : Number(r.shoot_id),
      rating: Number(r.rating),
      status: r.status as AssetStatus,
      notes: String(r.notes ?? ''),
      thumbPath: r.thumb_path == null ? null : String(r.thumb_path),
      pairedRawPath: r.paired_raw_path == null ? null : String(r.paired_raw_path),
      tags
    }
  }

  private tagsFor(ids: number[]): Map<number, string[]> {
    const map = new Map<number, string[]>()
    if (!ids.length) return map
    const rows = this.db.all<{ asset_id: number; tag: string }>(
      `SELECT asset_id, tag FROM asset_tags WHERE asset_id IN (${ids.map(() => '?').join(',')}) ORDER BY tag`,
      ids
    )
    for (const r of rows) {
      const list = map.get(Number(r.asset_id)) ?? []
      list.push(String(r.tag))
      map.set(Number(r.asset_id), list)
    }
    return map
  }

  list(filter: LibraryFilter): Asset[] {
    const where: string[] = []
    const params: (string | number)[] = []
    if (filter.kind && filter.kind !== 'all') {
      where.push('a.kind = ?')
      params.push(filter.kind)
    }
    if (filter.status && filter.status !== 'all') {
      where.push('a.status = ?')
      params.push(filter.status)
    } else {
      where.push("a.status != 'archived'")
    }
    if (filter.tag) {
      where.push('a.id IN (SELECT asset_id FROM asset_tags WHERE tag = ?)')
      params.push(filter.tag)
    }
    if (filter.shootId) {
      where.push('a.shoot_id = ?')
      params.push(filter.shootId)
    }
    if (filter.minRating) {
      where.push('a.rating >= ?')
      params.push(filter.minRating)
    }
    if (filter.onlyLog) where.push('a.is_log = 1')
    if (filter.search) {
      const q = `%${filter.search}%`
      where.push(
        '(a.original_name LIKE ? OR a.notes LIKE ? OR a.id IN (SELECT asset_id FROM asset_tags WHERE tag LIKE ?) OR a.shoot_id IN (SELECT id FROM shoots WHERE name LIKE ?))'
      )
      params.push(q, q, q, q)
    }
    const sql = `SELECT a.* FROM assets a ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.captured_at DESC LIMIT ${Math.min(filter.limit ?? 2000, 5000)}`
    const rows = this.db.all(sql, params)
    const tags = this.tagsFor(rows.map((r) => Number(r.id)))
    return rows.map((r) => this.toAsset(r, tags.get(Number(r.id)) ?? []))
  }

  get(id: number): Asset | null {
    const r = this.db.get('SELECT * FROM assets WHERE id = ?', [id])
    return r ? this.toAsset(r, this.tagsFor([id]).get(id) ?? []) : null
  }

  getMany(ids: number[]): Asset[] {
    return ids.map((id) => this.get(id)).filter((a): a is Asset => a !== null)
  }

  update(id: number, patch: { rating?: number; status?: AssetStatus; notes?: string; isLog?: boolean }): Asset | null {
    const sets: string[] = []
    const params: (string | number)[] = []
    if (patch.rating !== undefined) {
      sets.push('rating = ?')
      params.push(Math.max(0, Math.min(5, Math.round(patch.rating))))
    }
    if (patch.status !== undefined) {
      sets.push('status = ?')
      params.push(patch.status)
    }
    if (patch.notes !== undefined) {
      sets.push('notes = ?')
      params.push(patch.notes)
    }
    if (patch.isLog !== undefined) {
      sets.push('is_log = ?')
      params.push(patch.isLog ? 1 : 0)
    }
    if (sets.length) this.db.run(`UPDATE assets SET ${sets.join(', ')} WHERE id = ?`, [...params, id])
    return this.get(id)
  }

  setTags(ids: number[], tags: string[], mode: 'replace' | 'add'): void {
    const clean = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))]
    this.db.transaction(() => {
      for (const id of ids) {
        if (mode === 'replace') this.db.run('DELETE FROM asset_tags WHERE asset_id = ?', [id])
        for (const t of clean) this.db.run('INSERT OR IGNORE INTO asset_tags (asset_id, tag) VALUES (?, ?)', [id, t])
      }
    })
  }

  /** Removes items from the library database. Files on disk are left alone. */
  remove(ids: number[]): void {
    this.db.transaction(() => {
      for (const id of ids) {
        const thumb = this.db.get<{ thumb_path: string | null }>('SELECT thumb_path FROM assets WHERE id = ?', [id])?.thumb_path
        if (thumb) fs.rmSync(thumb, { force: true })
        this.db.run('DELETE FROM assets WHERE id = ?', [id])
      }
    })
  }

  listTags(): { tag: string; count: number }[] {
    return this.db
      .all<{ tag: string; count: number }>('SELECT tag, COUNT(*) AS count FROM asset_tags GROUP BY tag ORDER BY count DESC, tag')
      .map((r) => ({ tag: String(r.tag), count: Number(r.count) }))
  }

  listShoots(): Shoot[] {
    return this.db
      .all('SELECT s.*, (SELECT COUNT(*) FROM assets a WHERE a.shoot_id = s.id) AS asset_count FROM shoots s ORDER BY s.date DESC, s.id DESC')
      .map((r) => ({ id: Number(r.id), name: String(r.name), date: String(r.date), folder: String(r.folder), assetCount: Number(r.asset_count) }))
  }

  renameShoot(id: number, name: string): void {
    this.db.run('UPDATE shoots SET name = ? WHERE id = ?', [name.trim() || 'Untitled shoot', id])
  }

  /** Is this path one the library knows about (an asset, its thumbnail, or an export)? */
  isKnownPath(p: string): boolean {
    const norm = path.resolve(p)
    return Boolean(
      this.db.get('SELECT 1 FROM assets WHERE path = ? OR thumb_path = ? OR paired_raw_path = ?', [norm, norm, norm]) ||
        this.db.get('SELECT 1 FROM exports WHERE path = ?', [norm])
    )
  }

  // ---- camera cards ----

  private sourceKey(file: string, size: number, capturedAt: string): string {
    return `${path.basename(file).toLowerCase()}|${size}|${capturedAt.slice(0, 19)}`
  }

  private captureTime(file: string, stat: fs.Stats, kind: string): { capturedAt: string; sony: ReturnType<typeof readSonyMeta> } {
    const sony = kind === 'video' ? readSonyMeta(file) : null
    return { capturedAt: sony?.capturedAt ?? stat.mtime.toISOString(), sony }
  }

  /** Card roots currently mounted. Cheap: only checks folder layout. */
  cardRoots(): string[] {
    return candidateVolumes().filter((root) => detectCardLayout(root) !== null)
  }

  /** Full scan of cards, counting files not yet imported. Pass roots to limit the scan. */
  detectCards(roots: string[] = this.cardRoots()): CameraCard[] {
    const cards: CameraCard[] = []
    for (const root of roots) {
      const layout = detectCardLayout(root)
      if (!layout) continue
      const files = layout.mediaDirs.flatMap((d) => walkMedia(d))
      let videoCount = 0
      let photoCount = 0
      let newCount = 0
      for (const f of files) {
        const kind = kindForFile(f)
        if (kind === 'video') videoCount++
        else if (kind === 'photo' || kind === 'raw') photoCount++
        try {
          const stat = fs.statSync(f)
          const { capturedAt } = this.captureTime(f, stat, kind ?? '')
          if (!this.db.get('SELECT 1 FROM assets WHERE source_key = ?', [this.sourceKey(f, stat.size, capturedAt)])) newCount++
        } catch {
          /* unreadable file */
        }
      }
      cards.push({ root, label: path.basename(root) || root, camera: layout.camera, videoCount, photoCount, newCount })
    }
    return cards
  }

  // ---- importing ----

  private shootFor(dateStr: string, name: string | undefined, folder: string): number {
    const existing = this.db.get<{ id: number }>('SELECT id FROM shoots WHERE folder = ?', [folder])
    if (existing) return Number(existing.id)
    return this.db.run('INSERT INTO shoots (name, date, folder) VALUES (?, ?, ?)', [name?.trim() || `Shoot ${dateStr}`, dateStr, folder])
  }

  startImport(source: string, options: ImportOptions): string {
    const jobId = randomUUID()
    void this.runImport(jobId, source, options).catch((err: unknown) => {
      this.emit({ jobId, phase: 'error', current: 0, total: 0, error: err instanceof Error ? err.message : String(err) })
    })
    return jobId
  }

  private async runImport(jobId: string, source: string, options: ImportOptions): Promise<void> {
    this.emit({ jobId, phase: 'scanning', current: 0, total: 0 })
    const layout = detectCardLayout(source)
    const files = (layout ? layout.mediaDirs : [source]).flatMap((d) => walkMedia(d))
    const libraryRoot = this.getLibraryRoot()

    // Pair RAW files with a JPG of the same name so they show up as one photo.
    const byBase = new Map<string, string[]>()
    for (const f of files) {
      const key = path.join(path.dirname(f), path.basename(f, path.extname(f))).toLowerCase()
      byBase.set(key, [...(byBase.get(key) ?? []), f])
    }
    const rawPairs = new Map<string, string>() // jpg -> raw
    const pairedRaws = new Set<string>()
    for (const group of byBase.values()) {
      const raw = group.find((f) => kindForFile(f) === 'raw')
      const jpg = group.find((f) => kindForFile(f) === 'photo')
      if (raw && jpg) {
        rawPairs.set(jpg, raw)
        pairedRaws.add(raw)
      }
    }
    const todo = files.filter((f) => !pairedRaws.has(f))

    let imported = 0
    let skipped = 0
    const newIds: number[] = []
    for (let i = 0; i < todo.length; i++) {
      const file = todo[i]
      this.emit({ jobId, phase: 'copying', current: i + 1, total: todo.length, file: path.basename(file), imported, skipped })
      const kind = kindForFile(file)
      if (!kind) continue
      let stat: fs.Stats
      try {
        stat = fs.statSync(file)
      } catch {
        skipped++
        continue
      }
      const { capturedAt, sony } = this.captureTime(file, stat, kind)
      const key = this.sourceKey(file, stat.size, capturedAt)
      if (this.db.get('SELECT 1 FROM assets WHERE source_key = ?', [key])) {
        skipped++
        continue
      }

      const dateStr = localDate(capturedAt)
      const shootFolderName = options.shootName ? `${dateStr} ${safeName(options.shootName)}` : dateStr
      const shootFolder = path.join(libraryRoot, dateStr.slice(0, 4), shootFolderName)
      let finalPath = file
      let rawPath = rawPairs.get(file) ?? null
      if (options.mode === 'copy') {
        const name = options.renameByDate ? `${localStamp(capturedAt)}_${path.basename(file)}` : path.basename(file)
        finalPath = await copyInto(file, path.join(shootFolder, KIND_FOLDER[kind]), name)
        if (rawPath) {
          const rawName = options.renameByDate ? `${localStamp(capturedAt)}_${path.basename(rawPath)}` : path.basename(rawPath)
          rawPath = await copyInto(rawPath, path.join(shootFolder, KIND_FOLDER.raw), rawName)
        }
      }
      const shootId = this.shootFor(dateStr, options.shootName, options.mode === 'copy' ? shootFolder : path.dirname(file))
      const existingPath = this.db.get<{ id: number }>('SELECT id FROM assets WHERE path = ?', [path.resolve(finalPath)])
      if (existingPath) {
        skipped++
        continue
      }
      const id = this.db.run(
        `INSERT INTO assets (path, kind, original_name, size, captured_at, imported_at, camera, is_log, fps, shoot_id, paired_raw_path, source_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          path.resolve(finalPath), kind, path.basename(file), stat.size, capturedAt, new Date().toISOString(),
          sony?.camera ?? null, sony?.isLog ? 1 : 0, sony?.fps ?? null, shootId, rawPath ? path.resolve(rawPath) : null, key
        ]
      )
      if (options.tags?.length) this.setTags([id], options.tags, 'add')
      newIds.push(id)
      imported++
    }
    this.onChanged()

    for (let i = 0; i < newIds.length; i++) {
      const asset = this.get(newIds[i])
      if (!asset) continue
      this.emit({ jobId, phase: 'analysing', current: i + 1, total: newIds.length, file: path.basename(asset.path), imported, skipped })
      await this.analyse(asset)
    }
    this.emit({ jobId, phase: 'done', current: todo.length, total: todo.length, imported, skipped })
    this.onChanged()
  }

  /** Reads size, length and codec, and makes a thumbnail. */
  async analyse(asset: Asset): Promise<void> {
    if (asset.kind === 'raw' || asset.kind === 'audio') {
      if (asset.kind === 'audio') {
        const info = await probe(asset.path)
        if (info) this.db.run('UPDATE assets SET duration_sec = ?, codec = ? WHERE id = ?', [info.durationSec, info.codec, asset.id])
      }
      return
    }
    const info = await probe(asset.path)
    if (info) {
      const isVideo = asset.kind === 'video'
      this.db.run('UPDATE assets SET duration_sec = ?, width = ?, height = ?, fps = COALESCE(fps, ?), codec = ? WHERE id = ?', [
        isVideo ? info.durationSec : null,
        info.width,
        info.height,
        isVideo ? info.fps : null,
        isVideo ? info.codec : null,
        asset.id
      ])
    }
    const thumb = path.join(this.thumbsDir, `${asset.id}.jpg`)
    if (await makeThumbnail(asset.path, thumb, asset.kind === 'video', info?.durationSec ?? null)) {
      this.db.run('UPDATE assets SET thumb_path = ? WHERE id = ?', [thumb, asset.id])
    }
  }
}

/** Copies a file into a folder, keeping the name unless a different file already has it. */
async function copyInto(src: string, dir: string, name: string): Promise<string> {
  await fs.promises.mkdir(dir, { recursive: true })
  const ext = path.extname(name)
  const base = path.basename(name, ext)
  const srcSize = (await fs.promises.stat(src)).size
  for (let n = 0; n < 1000; n++) {
    const candidate = path.join(dir, n === 0 ? name : `${base} (${n})${ext}`)
    try {
      const existing = await fs.promises.stat(candidate)
      if (existing.size === srcSize) return candidate // already copied earlier
      continue
    } catch {
      // Copy under a temporary name first so a pulled card never leaves a half file behind.
      const partial = `${candidate}.part`
      await fs.promises.copyFile(src, partial)
      await fs.promises.rename(partial, candidate)
      return candidate
    }
  }
  throw new Error(`Could not find a free file name for ${name}`)
}
