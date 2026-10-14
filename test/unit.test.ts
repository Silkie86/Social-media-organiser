import { describe, expect, it } from 'vitest'
import { checkReadiness, getPreset } from '@shared/formats'
import type { Asset } from '@shared/types'
import { parseSonyXml } from '../src/main/library/camera'
import { parseProbe } from '../src/main/export/ffmpeg'
import { buildExportArgs, filterPath } from '../src/main/export/exporter'
import { computeBestTimes, weekStart } from '../src/main/planner'

function asset(over: Partial<Asset>): Asset {
  return {
    id: 1, path: '/x/C0001.MP4', kind: 'video', originalName: 'C0001.MP4', size: 500 * 1024 * 1024,
    capturedAt: '2026-10-10T20:00:00Z', importedAt: '2026-10-10T21:00:00Z', durationSec: 30, width: 1080, height: 1920,
    fps: 30, codec: 'h264', camera: 'Sony ZV-E10M2', isLog: false, shootId: 1, rating: 0, status: 'new', notes: '',
    thumbPath: null, pairedRawPath: null, tags: [], ...over
  }
}

describe('readiness', () => {
  it('says a vertical H.264 clip can go straight up as a Reel', () => {
    expect(checkReadiness(asset({}), getPreset('ig-reel')!).verdict).toBe('ready')
  })

  it('flags 4K landscape S-Log HEVC footage for export with clear reasons', () => {
    const r = checkReadiness(asset({ width: 3840, height: 2160, codec: 'hevc', isLog: true, durationSec: 400 }), getPreset('ig-reel')!)
    expect(r.verdict).toBe('export')
    const text = r.issues.map((i) => i.message).join(' | ')
    expect(text).toContain('16:9')
    expect(text).toContain('HEVC')
    expect(text).toContain('S-Log')
    expect(text).toContain('Too long')
  })

  it('rejects clips that are too short for a Spotify Canvas and photos for TikTok', () => {
    expect(checkReadiness(asset({ durationSec: 2 }), getPreset('spotify-canvas')!).verdict).toBe('unsupported')
    expect(checkReadiness(asset({ kind: 'photo', durationSec: null }), getPreset('tiktok')!).verdict).toBe('unsupported')
  })
})

describe('Sony metadata', () => {
  it('reads time, model and S-Log from the XML sidecar', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<NonRealTimeMeta xmlns="urn:schemas-professionalDisc:nonRealTimeMeta:ver.2.20">
  <Duration value="751"/>
  <CreationDate value="2026-10-11T22:41:05+01:00"/>
  <VideoFormat><VideoFrame videoCodec="HEVC_3840_2160_M10P@L51" captureFps="25p" formatFps="25p"/></VideoFormat>
  <Device manufacturer="Sony" modelName="ZV-E10M2" serialNo="1234"/>
  <AcquisitionRecord><Group name="CameraUnitMetadataSet">
    <Item name="CaptureGammaEquation" value="s-log3-cine"/>
  </Group></AcquisitionRecord>
</NonRealTimeMeta>`
    const m = parseSonyXml(xml)
    expect(m.capturedAt).toBe('2026-10-11T21:41:05.000Z')
    expect(m.camera).toBe('Sony ZV-E10M2')
    expect(m.isLog).toBe(true)
    expect(m.fps).toBe(25)
    expect(m.durationFrames).toBe(751)
  })
})

describe('ffmpeg output parsing', () => {
  it('reads size, length and codec, and swaps width/height for rotated vertical clips', () => {
    const stderr = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'C0002.MP4':
  Duration: 00:01:02.50, start: 0.000000, bitrate: 60123 kb/s
  Stream #0:0[0x1](und): Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt709), 3840x2160 [SAR 1:1 DAR 16:9], 59880 kb/s, 25 fps, 25 tbr, 25k tbn (default)
      Side data:
        displaymatrix: rotation of -90.00 degrees
  Stream #0:1[0x2](und): Audio: pcm_s16be (twos / 0x736F7774), 48000 Hz, stereo, s16, 1536 kb/s (default)`
    const p = parseProbe(stderr)
    expect(p.durationSec).toBeCloseTo(62.5)
    expect(p.codec).toBe('hevc')
    expect(p.width).toBe(2160)
    expect(p.height).toBe(3840)
    expect(p.fps).toBe(25)
    expect(p.hasAudio).toBe(true)
  })
})

describe('export command', () => {
  it('crops to fill, trims to the platform limit and keeps audio for Reels', () => {
    const { args, durationSec } = buildExportArgs({
      input: 'in.mp4', output: 'out.mp4', asset: { kind: 'video', durationSec: 400 }, preset: getPreset('ig-reel')!,
      options: { fitMode: 'fill', start: 10, normaliseAudio: true }
    })
    expect(durationSec).toBe(180)
    expect(args.join(' ')).toContain('crop=1080:1920')
    expect(args).toContain('loudnorm=I=-14:TP=-1:LRA=11')
    expect(args.slice(0, 2)).toEqual(['-ss', '10.000'])
  })

  it('removes audio for a Spotify Canvas', () => {
    const { args, durationSec } = buildExportArgs({
      input: 'in.mp4', output: 'out.mp4', asset: { kind: 'video', durationSec: 30 }, preset: getPreset('spotify-canvas')!,
      options: { fitMode: 'fill' }
    })
    expect(args).toContain('-an')
    expect(durationSec).toBe(8)
  })

  it('escapes Windows paths for filters', () => {
    expect(filterPath('C:\\LUTs\\SLog3.cube')).toBe("'C\\:/LUTs/SLog3.cube'")
  })
})

describe('planning helpers', () => {
  it('starts weeks on Monday', () => {
    const d = weekStart(new Date(2026, 9, 15, 13, 0)) // Thursday 15 Oct 2026
    expect(d.getDay()).toBe(1)
    expect(d.getDate()).toBe(12)
  })

  it('ranks time slots by engagement, weighting comments', () => {
    const at = (day: number, hour: number): string => new Date(2026, 9, day, hour, 0).toISOString()
    const slots = computeBestTimes([
      { id: '1', caption: '', mediaType: 'REEL', permalink: '', thumbnailUrl: null, timestamp: at(16, 19), likes: 100, comments: 10 },
      { id: '2', caption: '', mediaType: 'REEL', permalink: '', thumbnailUrl: null, timestamp: at(13, 9), likes: 20, comments: 0 }
    ])
    expect(slots[0].weekday).toBe(5)
    expect(slots[0].hour).toBe(18)
    expect(slots[0].avgEngagement).toBe(130)
  })
})
