// Export presets for every platform, plus a readiness check that tells you whether a
// file can go up as-is or needs an export. Presets are plain data so new platforms or
// changed specs only need an entry here.

import type { Asset, ExportOptions, FitMode, PresetReadiness, ReadinessIssue } from './types'

export interface FormatPreset {
  id: string
  platform: string
  platformName: string
  name: string
  kinds: ('video' | 'photo')[]
  width: number
  height: number
  minDurationSec?: number
  maxDurationSec?: number
  maxFileMB?: number
  fps?: number
  /** False for silent formats such as Spotify Canvas. */
  audio: boolean
  defaultFit: FitMode
  notes: string
}

export const PRESETS: FormatPreset[] = [
  {
    id: 'ig-reel', platform: 'instagram', platformName: 'Instagram', name: 'Reel (9:16)',
    kinds: ['video'], width: 1080, height: 1920, minDurationSec: 3, maxDurationSec: 180,
    fps: 30, audio: true, defaultFit: 'fill',
    notes: 'Keep text and faces out of the bottom fifth, where the caption and buttons sit.'
  },
  {
    id: 'ig-feed', platform: 'instagram', platformName: 'Instagram', name: 'Feed portrait (4:5)',
    kinds: ['photo', 'video'], width: 1080, height: 1350, maxDurationSec: 180,
    fps: 30, audio: true, defaultFit: 'fill',
    notes: 'Takes up the most room in the feed. Best for photos and carousels.'
  },
  {
    id: 'ig-square', platform: 'instagram', platformName: 'Instagram', name: 'Square (1:1)',
    kinds: ['photo', 'video'], width: 1080, height: 1080, maxDurationSec: 180,
    fps: 30, audio: true, defaultFit: 'fill',
    notes: 'Safe for grid previews and carousels that mix shapes.'
  },
  {
    id: 'ig-story', platform: 'instagram', platformName: 'Instagram', name: 'Story (9:16)',
    kinds: ['photo', 'video'], width: 1080, height: 1920, maxDurationSec: 60,
    fps: 30, audio: true, defaultFit: 'blur',
    notes: 'Stories over 60 seconds are split into parts.'
  },
  {
    id: 'tiktok', platform: 'tiktok', platformName: 'TikTok', name: 'Video (9:16)',
    kinds: ['video'], width: 1080, height: 1920, minDurationSec: 3, maxDurationSec: 600,
    fps: 30, audio: true, defaultFit: 'fill',
    notes: 'Hook in the first second. Keep the right edge clear for the like/comment buttons.'
  },
  {
    id: 'yt-short', platform: 'youtube', platformName: 'YouTube', name: 'Short (9:16)',
    kinds: ['video'], width: 1080, height: 1920, maxDurationSec: 180,
    fps: 30, audio: true, defaultFit: 'fill',
    notes: 'Vertical and under 3 minutes is treated as a Short.'
  },
  {
    id: 'yt-video', platform: 'youtube', platformName: 'YouTube', name: 'Video (16:9 HD)',
    kinds: ['video'], width: 1920, height: 1080,
    fps: 30, audio: true, defaultFit: 'fit',
    notes: 'For full mixes and studio sessions. 4K originals can be uploaded as-is.'
  },
  {
    id: 'yt-thumbnail', platform: 'youtube', platformName: 'YouTube', name: 'Thumbnail (16:9)',
    kinds: ['photo'], width: 1280, height: 720, maxFileMB: 2,
    audio: false, defaultFit: 'fill',
    notes: 'Under 2 MB. Big face, big text.'
  },
  {
    id: 'fb-reel', platform: 'facebook', platformName: 'Facebook', name: 'Reel (9:16)',
    kinds: ['video'], width: 1080, height: 1920, minDurationSec: 3, maxDurationSec: 90,
    fps: 30, audio: true, defaultFit: 'fill',
    notes: 'Can be cross-posted from Instagram.'
  },
  {
    id: 'x-video', platform: 'x', platformName: 'X', name: 'Video (16:9)',
    kinds: ['video'], width: 1280, height: 720, maxDurationSec: 140, maxFileMB: 512,
    fps: 30, audio: true, defaultFit: 'fit',
    notes: 'Free accounts are limited to 2 minutes 20 seconds.'
  },
  {
    id: 'spotify-canvas', platform: 'spotify', platformName: 'Spotify', name: 'Canvas loop',
    kinds: ['video'], width: 1080, height: 1920, minDurationSec: 3, maxDurationSec: 8,
    fps: 30, audio: false, defaultFit: 'fill',
    notes: 'A 3 to 8 second silent loop behind your track. Upload it in Spotify for Artists.'
  }
]

export function getPreset(id: string): FormatPreset | undefined {
  return PRESETS.find((p) => p.id === id)
}

export function presetsForPlatform(platform: string): FormatPreset[] {
  return PRESETS.filter((p) => p.platform === platform)
}

export function defaultExportOptions(preset: FormatPreset, asset: Asset): ExportOptions {
  return {
    fitMode: preset.defaultFit,
    start: 0,
    duration: preset.maxDurationSec && asset.durationSec ? Math.min(preset.maxDurationSec, asset.durationSec) : undefined,
    cropX: 0,
    applyLut: asset.isLog,
    normaliseAudio: preset.audio
  }
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec)) return '–'
  const s = Math.round(sec)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

function ratioName(w: number, h: number): string {
  const r = w / h
  const known: [number, string][] = [
    [9 / 16, '9:16'], [4 / 5, '4:5'], [1, '1:1'], [16 / 9, '16:9'], [3 / 2, '3:2'], [2 / 3, '2:3'], [4 / 3, '4:3']
  ]
  for (const [v, n] of known) if (Math.abs(r - v) < 0.02) return n
  return r.toFixed(2)
}

const UPLOAD_FRIENDLY_CODECS = ['h264', 'avc', 'avc1']

/** Decide whether an asset can be uploaded as-is for a preset, needs an export, or can't be used. */
export function checkReadiness(asset: Asset, preset: FormatPreset): PresetReadiness {
  const issues: ReadinessIssue[] = []
  const kind = asset.kind === 'raw' ? 'photo' : asset.kind
  if (kind === 'audio' || !preset.kinds.includes(kind)) {
    return {
      presetId: preset.id,
      verdict: 'unsupported',
      issues: [{ level: 'block', message: `${preset.platformName} ${preset.name} takes ${preset.kinds.join(' or ')}s only.` }]
    }
  }
  if (asset.kind === 'raw') {
    issues.push({ level: 'block', message: 'RAW (.ARW) files need editing first. Use the paired JPG instead.' })
    return { presetId: preset.id, verdict: 'unsupported', issues }
  }

  let needsExport = false
  const w = asset.width ?? 0
  const h = asset.height ?? 0
  if (w && h) {
    const srcRatio = w / h
    const dstRatio = preset.width / preset.height
    if (Math.abs(srcRatio - dstRatio) > 0.02) {
      needsExport = true
      issues.push({
        level: 'fix',
        message: `Shape is ${ratioName(w, h)}, needs ${ratioName(preset.width, preset.height)}. Will ${preset.defaultFit === 'fill' ? 'crop to fill' : 'fit with background'}.`
      })
    } else if (Math.max(w, h) < Math.max(preset.width, preset.height) * 0.9) {
      issues.push({ level: 'fix', message: `Resolution ${w}×${h} is below the recommended ${preset.width}×${preset.height}.` })
    } else if (Math.max(w, h) > Math.max(preset.width, preset.height) * 1.5 && preset.platform !== 'youtube') {
      needsExport = true
      issues.push({ level: 'fix', message: `${w}×${h} is larger than needed. Will resize to ${preset.width}×${preset.height} for a faster upload.` })
    } else {
      issues.push({ level: 'ok', message: `Shape ${ratioName(w, h)} matches.` })
    }
  } else {
    needsExport = true
    issues.push({ level: 'fix', message: 'Size unknown. Will export to be safe.' })
  }

  if (kind === 'video') {
    const d = asset.durationSec ?? 0
    if (preset.minDurationSec && d < preset.minDurationSec) {
      issues.push({ level: 'block', message: `Too short (${formatDuration(d)}). Needs at least ${preset.minDurationSec}s.` })
      return { presetId: preset.id, verdict: 'unsupported', issues }
    }
    if (preset.maxDurationSec && d > preset.maxDurationSec) {
      needsExport = true
      issues.push({ level: 'fix', message: `Too long (${formatDuration(d)}). Will trim to ${formatDuration(preset.maxDurationSec)}. Pick the best part in the export panel.` })
    }
    const codec = (asset.codec ?? '').toLowerCase()
    if (codec && !UPLOAD_FRIENDLY_CODECS.some((c) => codec.includes(c))) {
      needsExport = true
      issues.push({ level: 'fix', message: `${codec.toUpperCase()} video will be converted to H.264 so every app accepts it.` })
    }
    if (asset.isLog) {
      needsExport = true
      issues.push({ level: 'fix', message: 'Shot in S-Log, which looks flat. Export applies your LUT if one is set in Settings.' })
    }
    if (!preset.audio) {
      needsExport = true
      issues.push({ level: 'fix', message: 'This format is silent. Audio will be removed.' })
    }
  }

  if (preset.maxFileMB && asset.size > preset.maxFileMB * 1024 * 1024) {
    needsExport = true
    issues.push({ level: 'fix', message: `File is ${(asset.size / 1048576).toFixed(0)} MB, over the ${preset.maxFileMB} MB limit.` })
  }

  return { presetId: preset.id, verdict: needsExport ? 'export' : 'ready', issues }
}
