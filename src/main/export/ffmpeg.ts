// Thin wrapper around the bundled ffmpeg binary: reading media info, making thumbnails,
// and running exports with progress.

import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

let cachedPath: string | null | undefined

export function ffmpegPath(): string | null {
  if (cachedPath !== undefined) return cachedPath
  let p: string | null = null
  try {
    p = (require('ffmpeg-static') as string | null) ?? null
  } catch {
    p = null
  }
  // In the installed app the binary is unpacked next to the asar archive.
  if (p) p = p.replace('app.asar', 'app.asar.unpacked')
  cachedPath = p && fs.existsSync(p) ? p : null
  return cachedPath
}

export interface ProbeResult {
  durationSec: number | null
  width: number | null
  height: number | null
  fps: number | null
  codec: string | null
  hasAudio: boolean
}

interface RunResult {
  code: number | null
  stderr: string
  stdout: string
}

export function runFfmpeg(args: string[], onStderr?: (chunk: string) => void, signal?: AbortSignal): Promise<RunResult> {
  const bin = ffmpegPath()
  if (!bin) return Promise.reject(new Error('ffmpeg is not available'))
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-hide_banner', ...args], { windowsHide: true })
    let stderr = ''
    let stdout = ''
    child.stdout.on('data', (d: Buffer) => {
      stdout = (stdout + d.toString()).slice(-200000)
    })
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      stderr = (stderr + s).slice(-20000)
      onStderr?.(s)
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stderr, stdout }))
    signal?.addEventListener('abort', () => child.kill())
  })
}

/** Parses the info block `ffmpeg -i <file>` prints. Exported for tests. */
export function parseProbe(stderr: string): ProbeResult {
  const result: ProbeResult = { durationSec: null, width: null, height: null, fps: null, codec: null, hasAudio: false }
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
  if (dur) result.durationSec = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3])
  const video = /Stream #\S+.*?Video:\s*([a-zA-Z0-9_]+)[^\n]*?,\s*(\d{2,5})x(\d{2,5})/.exec(stderr)
  if (video) {
    result.codec = video[1]
    result.width = Number(video[2])
    result.height = Number(video[3])
  }
  const fps = /,\s*(\d+(?:\.\d+)?)\s*fps/.exec(stderr)
  if (fps) result.fps = Number(fps[1])
  result.hasAudio = /Stream #\S+.*?Audio:/.test(stderr)
  // Vertical clips are stored landscape with a rotation flag; report the shape you see.
  const rot = /rotation of (-?\d+(?:\.\d+)?) degrees/.exec(stderr) ?? /rotate\s*:\s*(-?\d+)/.exec(stderr)
  if (rot && Math.abs(Math.round(Number(rot[1]))) % 180 === 90 && result.width && result.height) {
    ;[result.width, result.height] = [result.height, result.width]
  }
  // Single images report a nominal duration we don't want.
  if (/Video:\s*(mjpeg|png|webp|bmp|tiff)/.test(stderr) && !/fps,/.test(stderr.split('Video:')[1] ?? '')) {
    result.durationSec = null
  }
  return result
}

let filtersCache: Promise<Set<string>> | null = null

/** Names of the filters this ffmpeg build has (builds differ between operating systems). */
export function availableFilters(): Promise<Set<string>> {
  filtersCache ??= runFfmpeg(['-filters'])
    .then(({ stdout }) => new Set([...stdout.matchAll(/^\s[A-Z.]{3}\s+(\S+)\s/gm)].map((m) => m[1])))
    .catch(() => new Set<string>())
  return filtersCache
}

export async function probe(file: string): Promise<ProbeResult | null> {
  if (!ffmpegPath()) return null
  // ffmpeg exits with an error when no output is given, but still prints the info we need.
  const { stderr } = await runFfmpeg(['-i', file])
  return parseProbe(stderr)
}

export async function makeThumbnail(file: string, out: string, isVideo: boolean, durationSec: number | null): Promise<boolean> {
  if (!ffmpegPath()) return false
  const seek = isVideo ? Math.min(1, (durationSec ?? 0) / 3) : 0
  const args = [
    ...(isVideo ? ['-ss', seek.toFixed(2)] : []),
    '-i', file,
    '-frames:v', '1',
    '-vf', 'scale=480:480:force_original_aspect_ratio=decrease',
    '-q:v', '4',
    '-y', out
  ]
  const { code } = await runFfmpeg(args)
  return code === 0 && fs.existsSync(out)
}
