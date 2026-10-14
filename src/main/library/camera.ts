// Camera-specific knowledge: where cameras put files on a memory card and what their
// metadata files say. Sony ZV-E10 II first; other cameras can add a profile below.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const VIDEO_EXT = new Set(['.mp4', '.mov', '.mts', '.m2ts', '.mxf'])
export const PHOTO_EXT = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.hif', '.webp'])
export const RAW_EXT = new Set(['.arw', '.cr2', '.cr3', '.nef', '.dng', '.raf', '.orf', '.rw2'])
export const AUDIO_EXT = new Set(['.wav', '.mp3', '.flac', '.aif', '.aiff', '.m4a'])

export function kindForFile(file: string): 'video' | 'photo' | 'raw' | 'audio' | null {
  const ext = path.extname(file).toLowerCase()
  if (VIDEO_EXT.has(ext)) return 'video'
  if (PHOTO_EXT.has(ext)) return 'photo'
  if (RAW_EXT.has(ext)) return 'raw'
  if (AUDIO_EXT.has(ext)) return 'audio'
  return null
}

export interface SonyClipMeta {
  capturedAt: string | null
  camera: string | null
  isLog: boolean
  fps: number | null
  durationFrames: number | null
}

/**
 * Sony cameras write an XML file next to each clip (C0001.MP4 -> C0001M01.XML) with the
 * real recording time, camera model and picture profile. Exported for tests.
 */
export function parseSonyXml(xml: string): SonyClipMeta {
  const attr = (tag: string, name: string): string | null => {
    const m = new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]*)"`, 'i').exec(xml)
    return m ? m[1] : null
  }
  const created = attr('CreationDate', 'value')
  const maker = attr('Device', 'manufacturer')
  const model = attr('Device', 'modelName')
  const gamma = /name="CaptureGammaEquation"\s+value="([^"]+)"/i.exec(xml)?.[1] ?? ''
  const fpsRaw = attr('VideoFrame', 'captureFps') ?? attr('VideoFrame', 'formatFps')
  const fps = fpsRaw ? parseFloat(fpsRaw) : null
  const frames = attr('Duration', 'value')
  return {
    capturedAt: created ? new Date(created).toISOString() : null,
    camera: [maker, model].filter(Boolean).join(' ') || null,
    isLog: /log/i.test(gamma),
    fps: fps && isFinite(fps) ? fps : null,
    durationFrames: frames ? Number(frames) : null
  }
}

export function sonySidecarFor(videoPath: string): string | null {
  const dir = path.dirname(videoPath)
  const base = path.basename(videoPath, path.extname(videoPath))
  for (const name of [`${base}M01.XML`, `${base}M01.xml`]) {
    const p = path.join(dir, name)
    if (fs.existsSync(p)) return p
  }
  return null
}

export function readSonyMeta(videoPath: string): SonyClipMeta | null {
  const sidecar = sonySidecarFor(videoPath)
  if (!sidecar) return null
  try {
    return parseSonyXml(fs.readFileSync(sidecar, 'utf8'))
  } catch {
    return null
  }
}

/** Places a removable card might be mounted on each operating system. */
export function candidateVolumes(): string[] {
  const out: string[] = []
  if (process.platform === 'win32') {
    for (let c = 'D'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) out.push(`${String.fromCharCode(c)}:\\`)
  } else if (process.platform === 'darwin') {
    try {
      for (const v of fs.readdirSync('/Volumes')) out.push(path.join('/Volumes', v))
    } catch {
      /* none */
    }
  } else {
    const user = os.userInfo().username
    for (const base of [`/media/${user}`, `/run/media/${user}`, '/media', '/mnt']) {
      try {
        for (const v of fs.readdirSync(base)) out.push(path.join(base, v))
      } catch {
        /* none */
      }
    }
  }
  return out
}

export interface CardLayout {
  camera: string
  mediaDirs: string[]
}

/** Recognises a camera card by its folder layout. Returns null for ordinary drives. */
export function detectCardLayout(root: string): CardLayout | null {
  const exists = (...p: string[]): boolean => {
    try {
      return fs.statSync(path.join(root, ...p)).isDirectory()
    } catch {
      return false
    }
  }
  const sonyClips = exists('PRIVATE', 'M4ROOT', 'CLIP')
  const dcim = exists('DCIM')
  if (!sonyClips && !dcim) return null
  const mediaDirs: string[] = []
  if (sonyClips) mediaDirs.push(path.join(root, 'PRIVATE', 'M4ROOT', 'CLIP'))
  if (dcim) mediaDirs.push(path.join(root, 'DCIM'))
  return { camera: sonyClips ? 'Sony (XAVC)' : 'Camera', mediaDirs }
}

/** Recursively lists media files under a folder, skipping system and thumbnail folders. */
export function walkMedia(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 8) return out
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'THMBNL' || e.name === '$RECYCLE.BIN' || e.name === 'System Volume Information') continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walkMedia(full, out, depth + 1)
    else if (e.isFile() && kindForFile(e.name)) out.push(full)
  }
  return out
}
