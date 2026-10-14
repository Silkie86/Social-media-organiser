// Posts, ideas, hashtag sets and the weekly dashboard.

import type { BestTimeSlot, DashboardSummary, HashtagSet, Idea, PlatformMedia, Post, PostStatus } from '@shared/types'
import { json, type Db, type Row } from './db'
import type { IdeaDraft } from './ai/claude'

/** Monday 00:00 local time of the week containing `d`. */
export function weekStart(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  const day = (out.getDay() + 6) % 7 // Monday = 0
  out.setDate(out.getDate() - day)
  return out
}

export class Planner {
  constructor(private readonly db: Db) {}

  // ---- posts ----

  private toPost(r: Row): Post {
    const id = Number(r.id)
    return {
      id,
      title: String(r.title),
      caption: String(r.caption),
      hashtags: json<string[]>(r.hashtags, []),
      targets: json<Post['targets']>(r.targets, []),
      assetIds: this.db.all<{ asset_id: number }>('SELECT asset_id FROM post_assets WHERE post_id = ? ORDER BY position', [id]).map((x) => Number(x.asset_id)),
      scheduledAt: r.scheduled_at == null ? null : String(r.scheduled_at),
      status: r.status as PostStatus,
      postedAt: r.posted_at == null ? null : String(r.posted_at),
      pillar: r.pillar == null ? null : String(r.pillar),
      notes: String(r.notes ?? ''),
      createdAt: String(r.created_at)
    }
  }

  listPosts(range?: { from: string; to: string }): Post[] {
    const rows = range
      ? this.db.all(
          `SELECT * FROM posts WHERE (scheduled_at BETWEEN ? AND ?) OR (posted_at BETWEEN ? AND ?) OR (scheduled_at IS NULL AND status != 'posted')
           ORDER BY COALESCE(scheduled_at, posted_at, created_at)`,
          [range.from, range.to, range.from, range.to]
        )
      : this.db.all('SELECT * FROM posts ORDER BY COALESCE(scheduled_at, posted_at, created_at) DESC LIMIT 500')
    return rows.map((r) => this.toPost(r))
  }

  getPost(id: number): Post | null {
    const r = this.db.get('SELECT * FROM posts WHERE id = ?', [id])
    return r ? this.toPost(r) : null
  }

  savePost(input: Partial<Post> & { title: string }): Post {
    const existing = input.id ? this.getPost(input.id) : null
    const merged: Post = {
      id: existing?.id ?? 0,
      title: input.title,
      caption: input.caption ?? existing?.caption ?? '',
      hashtags: input.hashtags ?? existing?.hashtags ?? [],
      targets: input.targets ?? existing?.targets ?? [],
      assetIds: input.assetIds ?? existing?.assetIds ?? [],
      scheduledAt: input.scheduledAt !== undefined ? input.scheduledAt : (existing?.scheduledAt ?? null),
      status: input.status ?? existing?.status ?? 'draft',
      postedAt: input.postedAt !== undefined ? input.postedAt : (existing?.postedAt ?? null),
      pillar: input.pillar !== undefined ? input.pillar : (existing?.pillar ?? null),
      notes: input.notes ?? existing?.notes ?? '',
      createdAt: existing?.createdAt ?? new Date().toISOString()
    }
    // Giving a draft a time makes it scheduled; removing the time puts it back.
    if (merged.status !== 'posted' && merged.status !== 'ready') {
      if (merged.scheduledAt && (merged.status === 'draft' || merged.status === 'idea')) merged.status = 'scheduled'
      if (!merged.scheduledAt && merged.status === 'scheduled') merged.status = 'draft'
    }
    const id = this.db.transaction(() => {
      const values = [
        merged.title, merged.caption, JSON.stringify(merged.hashtags), JSON.stringify(merged.targets), merged.scheduledAt,
        merged.status, merged.postedAt, merged.pillar, merged.notes
      ]
      let postId = merged.id
      if (existing) {
        const timeChanged = existing.scheduledAt !== merged.scheduledAt
        this.db.run(
          `UPDATE posts SET title = ?, caption = ?, hashtags = ?, targets = ?, scheduled_at = ?, status = ?, posted_at = ?, pillar = ?, notes = ?${timeChanged ? ', reminded_at = NULL' : ''} WHERE id = ?`,
          [...values, postId]
        )
      } else {
        postId = this.db.run(
          'INSERT INTO posts (title, caption, hashtags, targets, scheduled_at, status, posted_at, pillar, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [...values, merged.createdAt]
        )
      }
      this.db.run('DELETE FROM post_assets WHERE post_id = ?', [postId])
      merged.assetIds.forEach((assetId, position) =>
        this.db.run('INSERT OR IGNORE INTO post_assets (post_id, asset_id, position) VALUES (?, ?, ?)', [postId, assetId, position])
      )
      return postId
    })
    return this.getPost(id)!
  }

  deletePost(id: number): void {
    this.db.run('DELETE FROM posts WHERE id = ?', [id])
  }

  markPosted(id: number, platform?: string): Post {
    const post = this.getPost(id)
    if (!post) throw new Error('Post not found')
    const targets = post.targets.map((t) => (!platform || t.platform === platform ? { ...t, done: true } : t))
    const allDone = targets.length === 0 || targets.every((t) => t.done)
    const saved = this.savePost({
      ...post,
      targets,
      status: allDone ? 'posted' : post.status,
      postedAt: allDone ? new Date().toISOString() : post.postedAt
    })
    if (allDone && post.assetIds.length) {
      this.db.run(`UPDATE assets SET status = 'posted' WHERE id IN (${post.assetIds.map(() => '?').join(',')})`, post.assetIds)
    }
    return saved
  }

  /** Posts whose time is within `minutesAhead` and haven't been reminded yet. */
  dueForReminder(minutesAhead: number): Post[] {
    const until = new Date(Date.now() + minutesAhead * 60_000).toISOString()
    return this.db
      .all("SELECT * FROM posts WHERE status IN ('scheduled', 'ready') AND scheduled_at IS NOT NULL AND scheduled_at <= ? AND reminded_at IS NULL", [until])
      .map((r) => this.toPost(r))
  }

  markReminded(id: number): void {
    this.db.run('UPDATE posts SET reminded_at = ? WHERE id = ?', [new Date().toISOString(), id])
  }

  // ---- dashboard ----

  dashboard(weeklyGoal: number): DashboardSummary {
    const now = new Date()
    const thisWeek = weekStart(now)
    const posted = this.db
      .all<{ posted_at: string }>("SELECT posted_at FROM posts WHERE status = 'posted' AND posted_at IS NOT NULL ORDER BY posted_at DESC")
      .map((r) => new Date(String(r.posted_at)))
    const postsThisWeek = posted.filter((d) => d >= thisWeek).length

    // Weeks in a row (counting back from this week, or last week if this one isn't done yet) that hit the goal.
    let streakWeeks = 0
    const goal = Math.max(1, weeklyGoal)
    for (let w = 0; w < 104; w++) {
      const start = new Date(thisWeek)
      start.setDate(start.getDate() - 7 * w)
      const end = new Date(start)
      end.setDate(end.getDate() + 7)
      const count = posted.filter((d) => d >= start && d < end).length
      if (count >= goal) streakWeeks++
      else if (w > 0) break
    }

    const in7 = new Date(now.getTime() + 7 * 86_400_000).toISOString()
    const nowIso = now.toISOString()
    const upcoming = this.db
      .all("SELECT * FROM posts WHERE status != 'posted' AND scheduled_at >= ? AND scheduled_at <= ? ORDER BY scheduled_at", [nowIso, in7])
      .map((r) => this.toPost(r))
    const overdue = this.db
      .all("SELECT * FROM posts WHERE status != 'posted' AND scheduled_at < ? ORDER BY scheduled_at", [nowIso])
      .map((r) => this.toPost(r))
    const count = (sql: string): number => Number(this.db.get<{ n: number }>(sql)?.n ?? 0)
    return {
      postsThisWeek,
      weeklyGoal,
      streakWeeks,
      upcoming,
      overdue,
      unsortedCount: count("SELECT COUNT(*) AS n FROM assets WHERE status = 'new' AND id NOT IN (SELECT asset_id FROM asset_tags)"),
      newIdeas: count("SELECT COUNT(*) AS n FROM ideas WHERE status IN ('new', 'saved')"),
      readyToPost: count("SELECT COUNT(*) AS n FROM posts WHERE status = 'ready'"),
      lastPostedAt: posted[0]?.toISOString() ?? null,
      totalAssets: count("SELECT COUNT(*) AS n FROM assets WHERE status != 'archived'")
    }
  }

  // ---- ideas ----

  private toIdea(r: Row): Idea {
    return {
      id: Number(r.id),
      title: String(r.title),
      description: String(r.description),
      format: String(r.format),
      pillar: String(r.pillar),
      hook: String(r.hook),
      status: r.status as Idea['status'],
      source: r.source as Idea['source'],
      createdAt: String(r.created_at)
    }
  }

  listIdeas(status?: Idea['status']): Idea[] {
    const rows = status
      ? this.db.all('SELECT * FROM ideas WHERE status = ? ORDER BY id DESC', [status])
      : this.db.all("SELECT * FROM ideas WHERE status != 'dismissed' ORDER BY CASE status WHEN 'saved' THEN 0 WHEN 'new' THEN 1 ELSE 2 END, id DESC")
    return rows.map((r) => this.toIdea(r))
  }

  addIdeas(drafts: IdeaDraft[], source: Idea['source'] = 'ai'): Idea[] {
    const now = new Date().toISOString()
    const ids = this.db.transaction(() =>
      drafts.map((d) =>
        this.db.run('INSERT INTO ideas (title, description, format, pillar, hook, status, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
          d.title, d.description, d.format, d.pillar, d.hook, 'new', source, now
        ])
      )
    )
    return ids.map((id) => this.toIdea(this.db.get('SELECT * FROM ideas WHERE id = ?', [id])!))
  }

  updateIdea(id: number, patch: Partial<Pick<Idea, 'status' | 'title' | 'description'>>): void {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || !['status', 'title', 'description'].includes(k)) continue
      this.db.run(`UPDATE ideas SET ${k} = ? WHERE id = ?`, [v, id])
    }
  }

  ideaToPost(id: number): Post {
    const r = this.db.get('SELECT * FROM ideas WHERE id = ?', [id])
    if (!r) throw new Error('Idea not found')
    const idea = this.toIdea(r)
    this.updateIdea(id, { status: 'used' })
    return this.savePost({
      title: idea.title,
      notes: `${idea.hook ? `Hook: ${idea.hook}\n` : ''}Format: ${idea.format}\n\n${idea.description}`,
      pillar: idea.pillar,
      status: 'draft'
    })
  }

  // ---- hashtag sets ----

  listHashtagSets(): HashtagSet[] {
    return this.db.all('SELECT * FROM hashtag_sets ORDER BY name').map((r) => ({ id: Number(r.id), name: String(r.name), tags: json<string[]>(r.tags, []) }))
  }

  saveHashtagSet(set: { id?: number; name: string; tags: string[] }): HashtagSet {
    const tags = [...new Set(set.tags.map((t) => t.replace(/^#/, '').trim()).filter(Boolean))]
    let id = set.id
    if (id) this.db.run('UPDATE hashtag_sets SET name = ?, tags = ? WHERE id = ?', [set.name, JSON.stringify(tags), id])
    else id = this.db.run('INSERT INTO hashtag_sets (name, tags) VALUES (?, ?)', [set.name, JSON.stringify(tags)])
    return { id, name: set.name, tags }
  }

  deleteHashtagSet(id: number): void {
    this.db.run('DELETE FROM hashtag_sets WHERE id = ?', [id])
  }

  // ---- platform media cache & best times ----

  cacheMedia(platform: string, media: PlatformMedia[]): void {
    this.db.transaction(() => {
      for (const m of media) {
        this.db.run('INSERT INTO platform_media (platform, id, data, timestamp) VALUES (?, ?, ?, ?) ON CONFLICT(platform, id) DO UPDATE SET data = excluded.data', [
          platform, m.id, JSON.stringify(m), m.timestamp
        ])
      }
    })
  }

  cachedMedia(platform: string): PlatformMedia[] {
    return this.db
      .all('SELECT data FROM platform_media WHERE platform = ? ORDER BY timestamp DESC LIMIT 100', [platform])
      .map((r) => json<PlatformMedia | null>(r.data, null))
      .filter((m): m is PlatformMedia => m !== null)
  }

  bestTimes(platform: string): BestTimeSlot[] {
    return computeBestTimes(this.cachedMedia(platform))
  }
}

/** Average likes + comments by weekday and 3-hour block of the day, best first. Exported for tests. */
export function computeBestTimes(media: PlatformMedia[]): BestTimeSlot[] {
  const buckets = new Map<string, { weekday: number; hour: number; total: number; posts: number }>()
  for (const m of media) {
    if (m.likes == null) continue
    const d = new Date(m.timestamp)
    const hour = Math.floor(d.getHours() / 3) * 3
    const key = `${d.getDay()}-${hour}`
    const b = buckets.get(key) ?? { weekday: d.getDay(), hour, total: 0, posts: 0 }
    b.total += (m.likes ?? 0) + (m.comments ?? 0) * 3
    b.posts++
    buckets.set(key, b)
  }
  return [...buckets.values()]
    .map((b) => ({ weekday: b.weekday, hour: b.hour, avgEngagement: b.total / b.posts, posts: b.posts }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement)
}
