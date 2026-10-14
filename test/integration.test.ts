// End-to-end check of the main workflow with the real ffmpeg binary: import a fake Sony
// card, analyse it, export for Reels and Spotify Canvas, then plan and post.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ExportJob, ImportProgress } from '@shared/types'
import { Db } from '../src/main/db'
import { Library } from '../src/main/library/library'
import { Exporter } from '../src/main/export/exporter'
import { Planner } from '../src/main/planner'
import { ffmpegPath, probe, runFfmpeg } from '../src/main/export/ffmpeg'

const hasFfmpeg = ffmpegPath() !== null
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crate-test-'))
const card = path.join(tmp, 'card')
const libraryRoot = path.join(tmp, 'library')

const SONY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<NonRealTimeMeta>
  <Duration value="100"/>
  <CreationDate value="2026-10-11T22:41:05+01:00"/>
  <VideoFormat><VideoFrame videoCodec="HEVC" captureFps="25p" formatFps="25p"/></VideoFormat>
  <Device manufacturer="Sony" modelName="ZV-E10M2" serialNo="1"/>
  <AcquisitionRecord><Group name="CameraUnitMetadataSet"><Item name="CaptureGammaEquation" value="s-log3-cine"/></Group></AcquisitionRecord>
</NonRealTimeMeta>`

describe.skipIf(!hasFfmpeg)('import → export → post', () => {
  let db: Db
  let library: Library
  let exporter: Exporter
  const progress: ImportProgress[] = []
  const jobs = new Map<number, ExportJob>()

  beforeAll(async () => {
    const clipDir = path.join(card, 'PRIVATE', 'M4ROOT', 'CLIP')
    const photoDir = path.join(card, 'DCIM', '100MSDCF')
    fs.mkdirSync(clipDir, { recursive: true })
    fs.mkdirSync(photoDir, { recursive: true })
    await runFfmpeg([
      '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=25:duration=4',
      '-f', 'lavfi', '-i', 'sine=frequency=55:duration=4',
      '-c:v', 'libx265', '-preset', 'ultrafast', '-tag:v', 'hvc1', '-c:a', 'aac', '-shortest', '-y', path.join(clipDir, 'C0001.MP4')
    ])
    fs.writeFileSync(path.join(clipDir, 'C0001M01.XML'), SONY_XML)
    await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=6000x4000', '-frames:v', '1', '-y', path.join(photoDir, 'DSC00001.JPG')])
    fs.writeFileSync(path.join(photoDir, 'DSC00001.ARW'), Buffer.alloc(1024, 1))

    db = await Db.open(path.join(tmp, 'crate.db'))
    library = new Library(db, path.join(tmp, 'thumbs'), () => libraryRoot, (p) => progress.push(p), () => {})
    exporter = new Exporter(db, (id) => library.get(id), () => libraryRoot, () => '', (j) => jobs.set(j.id, j))
  }, 60_000)

  it('imports a Sony card into dated shoot folders, pairing RAW with JPG', async () => {
    library.startImport(card, { mode: 'copy', renameByDate: true, shootName: 'Studio jam', tags: ['studio'] })
    await waitFor(() => progress.some((p) => p.phase === 'done' || p.phase === 'error'))
    expect(progress.find((p) => p.phase === 'error')).toBeUndefined()

    const assets = library.list({})
    expect(assets).toHaveLength(2)
    const clip = assets.find((a) => a.kind === 'video')!
    expect(clip.camera).toBe('Sony ZV-E10M2')
    expect(clip.isLog).toBe(true)
    expect(clip.capturedAt).toBe('2026-10-11T21:41:05.000Z')
    expect(clip.codec).toBe('hevc')
    expect(clip.width).toBe(1920)
    expect(clip.durationSec).toBeCloseTo(4, 0)
    expect(clip.thumbPath && fs.existsSync(clip.thumbPath)).toBe(true)
    expect(clip.tags).toEqual(['studio'])
    expect(clip.path).toContain(path.join('2026', '2026-10-11 Studio jam', 'Video'))
    expect(path.basename(clip.path)).toMatch(/^2026-10-11_\d{6}_C0001\.MP4$/)

    const photo = assets.find((a) => a.kind === 'photo')!
    expect(photo.pairedRawPath).toMatch(/DSC00001\.ARW$/)
    expect(fs.existsSync(photo.pairedRawPath!)).toBe(true)

    // Importing the same card again skips everything.
    progress.length = 0
    library.startImport(card, { mode: 'copy', renameByDate: true })
    await waitFor(() => progress.some((p) => p.phase === 'done'))
    expect(progress.at(-1)?.skipped).toBe(2)
    expect(library.list({})).toHaveLength(2)
  }, 60_000)

  it('exports a landscape clip as a vertical Reel with text, and a silent Canvas loop', async () => {
    const clip = library.list({ kind: 'video' })[0]
    const queued = [
      ...exporter.enqueue(clip.id, ['ig-reel'], { fitMode: 'blur', overlayText: 'NEW TUNE OUT FRIDAY' }),
      ...exporter.enqueue(clip.id, ['spotify-canvas'], {})
    ]
    await waitFor(() => queued.every((q) => ['done', 'error'].includes(jobs.get(q.id)?.status ?? '')), 120_000)
    for (const q of queued) expect(jobs.get(q.id)?.error ?? null).toBeNull()

    const reel = await probe(jobs.get(queued[0].id)!.path!)
    expect([reel?.width, reel?.height]).toEqual([1080, 1920])
    expect(reel?.codec).toBe('h264')
    expect(reel?.hasAudio).toBe(true)

    const canvas = await probe(jobs.get(queued[1].id)!.path!)
    expect([canvas?.width, canvas?.height]).toEqual([1080, 1920])
    expect(canvas?.hasAudio).toBe(false)

    const photo = library.list({ kind: 'photo' })[0]
    const [pj] = exporter.enqueue(photo.id, ['ig-feed'], {})
    await waitFor(() => ['done', 'error'].includes(jobs.get(pj.id)?.status ?? ''), 60_000)
    const feed = await probe(jobs.get(pj.id)!.path!)
    expect([feed?.width, feed?.height]).toEqual([1080, 1350])
  }, 180_000)

  it('plans a post, marks it posted per platform and counts it toward the weekly goal', () => {
    const planner = new Planner(db)
    const clip = library.list({ kind: 'video' })[0]
    const post = planner.savePost({
      title: 'Studio jam clip',
      assetIds: [clip.id],
      targets: [
        { platform: 'instagram', presetId: 'ig-reel' },
        { platform: 'tiktok', presetId: 'tiktok' }
      ],
      scheduledAt: new Date(Date.now() + 10 * 60_000).toISOString()
    })
    expect(post.status).toBe('scheduled')
    expect(planner.dueForReminder(30).map((p) => p.id)).toContain(post.id)

    expect(planner.markPosted(post.id, 'instagram').status).toBe('scheduled')
    const done = planner.markPosted(post.id, 'tiktok')
    expect(done.status).toBe('posted')
    expect(library.get(clip.id)?.status).toBe('posted')
    expect(planner.dashboard(3).postsThisWeek).toBe(1)
  })

  it('keeps data after the database is saved and reopened', async () => {
    db.flush()
    const reopened = await Db.open(path.join(tmp, 'crate.db'))
    expect(reopened.get<{ n: number }>('SELECT COUNT(*) AS n FROM assets')?.n).toBe(2)
    expect(reopened.get<{ n: number }>('SELECT COUNT(*) AS n FROM posts')?.n).toBe(1)
  })
})

async function waitFor(check: () => boolean, timeout = 60_000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting')
    await new Promise((r) => setTimeout(r, 100))
  }
}
