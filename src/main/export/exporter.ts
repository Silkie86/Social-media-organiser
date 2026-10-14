// Turns a clip or photo into upload-ready files for each platform: right shape, right
// length, H.264, optional LUT for S-Log footage, and loudness-normalised audio.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Asset, ExportJob, ExportOptions } from '@shared/types'
import { defaultExportOptions, getPreset, type FormatPreset } from '@shared/formats'
import type { Db, Row } from '../db'
import { availableFilters, runFfmpeg } from './ffmpeg'

/** Escapes a file path for use inside an ffmpeg filter option. */
export function filterPath(p: string): string {
  return `'${p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\\\''")}'`
}

function defaultFontFile(): string | null {
  const candidates =
    process.platform === 'win32'
      ? ['C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/arial.ttf']
      : process.platform === 'darwin'
        ? ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/Library/Fonts/Arial Bold.ttf']
        : ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf']
  return candidates.find((c) => fs.existsSync(c)) ?? null
}

export interface BuildArgsInput {
  input: string
  output: string
  asset: Pick<Asset, 'kind' | 'durationSec'>
  preset: FormatPreset
  options: ExportOptions
  lutPath?: string | null
  /** Burned-in text: an .ass subtitle file (preferred) or a plain text file for drawtext. */
  overlay?: { kind: 'ass' | 'drawtext'; file: string; fontFile?: string | null } | null
}

/** A one-line subtitle file styled as big, outlined text near the top of the frame. Exported for tests. */
export function buildAssFile(text: string, width: number, height: number): string {
  const clean = text.replace(/[{}]/g, '').replace(/\r?\n/g, '\\N').trim()
  const size = Math.round(Math.min(width, height) * 0.075)
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Arial,${size},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(size / 12))},2,8,${Math.round(width * 0.06)},${Math.round(width * 0.06)},${Math.round(height * 0.12)},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    `Dialogue: 0,0:00:00.00,9:59:59.00,Default,,0,0,0,,${clean}`,
    ''
  ].join('\n')
}

/** Builds the ffmpeg command line for one export. Pure, so it can be tested. */
export function buildExportArgs(i: BuildArgsInput): { args: string[]; durationSec: number | null } {
  const { preset, options } = i
  const W = preset.width
  const H = preset.height
  const isVideo = i.asset.kind === 'video'

  const pre: string[] = []
  if (options.applyLut && i.lutPath) pre.push(`lut3d=file=${filterPath(i.lutPath)}`)

  const cropX = Math.max(-1, Math.min(1, options.cropX ?? 0))
  const fill = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-${W})*${((1 + cropX) / 2).toFixed(3)}:(ih-${H})/2`
  const post: string[] = ['setsar=1']
  if (i.overlay?.kind === 'ass') {
    post.push(`ass=filename=${filterPath(i.overlay.file)}`)
  } else if (i.overlay?.kind === 'drawtext') {
    const font = i.overlay.fontFile ? `:fontfile=${filterPath(i.overlay.fontFile)}` : ''
    post.push(
      `drawtext=textfile=${filterPath(i.overlay.file)}${font}:fontsize=${Math.round(H * 0.045)}:fontcolor=white:borderw=4:bordercolor=black@0.7:x=(w-text_w)/2:y=h*0.12`
    )
  }

  const head = pre.length ? `[0:v]${pre.join(',')},` : '[0:v]'
  let graph: string
  if (options.fitMode === 'blur') {
    graph =
      `${head}split=2[a][b];` +
      `[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=40:2[bg];` +
      `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,${post.join(',')}[v]`
  } else if (options.fitMode === 'fit') {
    graph = `${head}scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,${post.join(',')}[v]`
  } else {
    graph = `${head}${fill},${post.join(',')}[v]`
  }

  const args: string[] = []
  let durationSec: number | null = null
  if (isVideo) {
    const start = Math.max(0, options.start ?? 0)
    const available = Math.max(0, (i.asset.durationSec ?? Infinity) - start)
    durationSec = Math.min(options.duration ?? available, available, preset.maxDurationSec ?? Infinity)
    if (!isFinite(durationSec)) durationSec = null
    if (start > 0) args.push('-ss', start.toFixed(3))
    args.push('-i', i.input)
    if (durationSec != null) args.push('-t', durationSec.toFixed(3))
    args.push('-filter_complex', graph, '-map', '[v]')
    if (preset.audio) {
      args.push('-map', '0:a:0?', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000')
      if (options.normaliseAudio) args.push('-af', 'loudnorm=I=-14:TP=-1:LRA=11')
    } else {
      args.push('-an')
    }
    args.push(
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
      '-r', String(preset.fps ?? 30), '-movflags', '+faststart'
    )
  } else {
    args.push('-i', i.input, '-filter_complex', graph, '-map', '[v]', '-frames:v', '1', '-q:v', '2')
  }
  args.push('-y', i.output)
  return { args, durationSec }
}

export class Exporter {
  private queue: number[] = []
  private running = false

  constructor(
    private readonly db: Db,
    private readonly getAsset: (id: number) => Asset | null,
    private readonly getLibraryRoot: () => string,
    private readonly getLutPath: () => string,
    private readonly emit: (job: ExportJob) => void
  ) {
    // Anything left running when the app closed is re-queued.
    for (const r of this.db.all<{ id: number }>("SELECT id FROM exports WHERE status IN ('queued', 'running')")) {
      this.queue.push(Number(r.id))
    }
    void this.pump()
  }

  private toJob(r: Row): ExportJob {
    return {
      id: Number(r.id),
      assetId: Number(r.asset_id),
      presetId: String(r.preset_id),
      path: r.path == null ? null : String(r.path),
      status: r.status as ExportJob['status'],
      progress: Number(r.progress),
      error: r.error == null ? null : String(r.error),
      createdAt: String(r.created_at)
    }
  }

  list(assetId?: number): ExportJob[] {
    const rows = assetId
      ? this.db.all('SELECT * FROM exports WHERE asset_id = ? ORDER BY id DESC', [assetId])
      : this.db.all('SELECT * FROM exports ORDER BY id DESC LIMIT 300')
    return rows.map((r) => this.toJob(r))
  }

  /** Most recent finished export per preset for an asset. */
  doneFor(assetId: number): Map<string, string> {
    const map = new Map<string, string>()
    for (const r of this.db.all("SELECT preset_id, path FROM exports WHERE asset_id = ? AND status = 'done' ORDER BY id DESC", [assetId])) {
      const p = String(r.path)
      if (!map.has(String(r.preset_id)) && fs.existsSync(p)) map.set(String(r.preset_id), p)
    }
    return map
  }

  enqueue(assetId: number, presetIds: string[], options: Partial<ExportOptions>): ExportJob[] {
    const asset = this.getAsset(assetId)
    if (!asset) throw new Error('That item is no longer in the library.')
    const jobs: ExportJob[] = []
    for (const presetId of presetIds) {
      const preset = getPreset(presetId)
      if (!preset) continue
      const merged: ExportOptions = { ...defaultExportOptions(preset, asset), ...options }
      // A per-preset fit only makes sense if the caller didn't pick one explicitly.
      if (!options.fitMode) merged.fitMode = preset.defaultFit
      const id = this.db.run("INSERT INTO exports (asset_id, preset_id, status, options, created_at) VALUES (?, ?, 'queued', ?, ?)", [
        assetId,
        presetId,
        JSON.stringify(merged),
        new Date().toISOString()
      ])
      this.queue.push(id)
      const job = this.toJob(this.db.get('SELECT * FROM exports WHERE id = ?', [id])!)
      jobs.push(job)
      this.emit(job)
    }
    void this.pump()
    return jobs
  }

  private update(id: number, fields: Partial<{ status: string; progress: number; error: string | null; path: string }>): void {
    const sets = Object.keys(fields).map((k) => `${k} = ?`)
    this.db.run(`UPDATE exports SET ${sets.join(', ')} WHERE id = ?`, [...(Object.values(fields) as (string | number | null)[]), id])
    const row = this.db.get('SELECT * FROM exports WHERE id = ?', [id])
    if (row) this.emit(this.toJob(row))
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!
        try {
          await this.runOne(id)
        } catch (err) {
          this.update(id, { status: 'error', error: err instanceof Error ? err.message : String(err) })
        }
      }
    } finally {
      this.running = false
    }
  }

  private async runOne(id: number): Promise<void> {
    const row = this.db.get('SELECT * FROM exports WHERE id = ?', [id])
    if (!row) return
    const asset = this.getAsset(Number(row.asset_id))
    const preset = getPreset(String(row.preset_id))
    if (!asset || !preset) throw new Error('Missing item or format')
    const options = JSON.parse(String(row.options)) as ExportOptions

    const ext = asset.kind === 'video' ? '.mp4' : '.jpg'
    const folder = path.join(this.getLibraryRoot(), 'Ready to Post', `${preset.platformName} - ${preset.name.replace(/[:/\\]/g, 'x')}`)
    fs.mkdirSync(folder, { recursive: true })
    const base = path.basename(asset.path, path.extname(asset.path))
    const output = path.join(folder, `${base}_${preset.id}${ext}`)

    let overlay: BuildArgsInput['overlay'] = null
    if (options.overlayText?.trim()) {
      const filters = await availableFilters()
      if (filters.has('ass')) {
        overlay = { kind: 'ass', file: path.join(os.tmpdir(), `crate-text-${id}.ass`) }
        fs.writeFileSync(overlay.file, buildAssFile(options.overlayText, preset.width, preset.height), 'utf8')
      } else if (filters.has('drawtext')) {
        overlay = { kind: 'drawtext', file: path.join(os.tmpdir(), `crate-text-${id}.txt`), fontFile: defaultFontFile() }
        fs.writeFileSync(overlay.file, options.overlayText.trim(), 'utf8')
      }
      // With neither filter available the export still runs, just without the text.
    }
    const lut = this.getLutPath()
    const { args, durationSec } = buildExportArgs({
      input: asset.path,
      output,
      asset,
      preset,
      options,
      lutPath: lut && fs.existsSync(lut) ? lut : null,
      overlay
    })

    this.update(id, { status: 'running', progress: 0, error: null })
    let lastSent = 0
    const { code, stderr } = await runFfmpeg(args, (chunk) => {
      const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(chunk)
      if (!m || !durationSec) return
      const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
      const progress = Math.min(0.99, t / durationSec)
      if (progress - lastSent > 0.02) {
        lastSent = progress
        this.update(id, { progress })
      }
    })
    if (overlay) fs.rmSync(overlay.file, { force: true })
    if (code !== 0) {
      const lastLines = stderr.trim().split('\n').slice(-3).join(' ')
      throw new Error(`Export failed: ${lastLines}`)
    }
    this.update(id, { status: 'done', progress: 1, path: output })
  }
}
