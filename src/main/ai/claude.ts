// Content ideas and captions from Claude, written with the artist's own profile, recent
// footage and posting history as context.

import fs from 'node:fs'
import Anthropic from '@anthropic-ai/sdk'
import type { AppSettings, Asset, CaptionResult, IdeaRequest, Post } from '@shared/types'

export interface IdeaDraft {
  title: string
  description: string
  format: string
  pillar: string
  hook: string
}

const IDEAS_SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          hook: { type: 'string' },
          description: { type: 'string' },
          format: { type: 'string' },
          pillar: { type: 'string' }
        },
        required: ['title', 'hook', 'description', 'format', 'pillar'],
        additionalProperties: false
      }
    }
  },
  required: ['ideas'],
  additionalProperties: false
}

const CAPTION_SCHEMA = {
  type: 'object',
  properties: {
    caption: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    alternatives: { type: 'array', items: { type: 'string' } }
  },
  required: ['caption', 'hashtags', 'alternatives'],
  additionalProperties: false
}

function profileBlock(s: AppSettings): string {
  const p = s.profile
  return [
    `Artist name: ${p.artistName || '(not set)'}`,
    `Genres: ${p.genres}`,
    p.sound && `Sound and influences: ${p.sound}`,
    p.location && `Based in: ${p.location}`,
    p.audience && `Audience: ${p.audience}`,
    p.tone && `Tone of voice: ${p.tone}`,
    p.upcoming && `Coming up (releases, gigs): ${p.upcoming}`,
    p.links && `Links to mention: ${p.links}`,
    `Content pillars: ${s.pillars.join(', ')}`,
    `Weekly posting goal: ${s.weeklyPostGoal} posts`
  ]
    .filter(Boolean)
    .join('\n')
}

const SYSTEM = `You are the social media partner for an independent DJ and music producer. They are great at making music and filming it, and less keen on the posting side, so your job is to make posting feel easy.

Write like a person in the scene, not a marketer. Keep ideas cheap to make with a single camera (a Sony ZV-E10 II) and footage they already have. Favour short vertical video, because that is where discovery happens, and say which platforms each idea suits. Use British English.`

export class ContentAI {
  constructor(private readonly getKey: () => string | null) {}

  private client(): Anthropic {
    const apiKey = this.getKey()
    if (!apiKey) throw new Error('Add your Claude API key in Settings to use ideas and captions.')
    return new Anthropic({ apiKey })
  }

  /** Checks a key works with a tiny request. */
  static async verifyKey(apiKey: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await new Anthropic({ apiKey }).models.list({ limit: 1 })
      return { ok: true }
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) return { ok: false, error: 'That key was not accepted. Check it was copied in full.' }
      if (err instanceof Anthropic.APIConnectionError) return { ok: false, error: 'Could not reach Claude. Check your internet connection.' }
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private async askJson<T>(model: string, content: Anthropic.Beta.BetaContentBlockParam[] | string, schema: Record<string, unknown>): Promise<T> {
    let response: Anthropic.Beta.BetaMessage
    try {
      response = await this.client().beta.messages.create({
        model,
        max_tokens: 16000,
        system: SYSTEM,
        // If a request is declined by a safety check, retry on a suitable fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
        messages: [{ role: 'user', content }]
      })
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new Error('Your Claude API key was not accepted. Update it in Settings.')
      if (err instanceof Anthropic.RateLimitError) throw new Error('Claude is busy or your usage limit was reached. Try again in a minute.')
      if (err instanceof Anthropic.APIConnectionError) throw new Error('Could not reach Claude. Check your internet connection.')
      throw err
    }
    if (response.stop_reason === 'refusal') throw new Error('Claude declined this request. Try rewording your notes.')
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    return JSON.parse(text) as T
  }

  async ideas(settings: AppSettings, req: IdeaRequest, recentAssets: Asset[], recentPosts: Post[], tagCounts: { tag: string; count: number }[]): Promise<IdeaDraft[]> {
    const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    const footage = recentAssets
      .slice(0, 40)
      .map((a) => `- ${a.kind} ${a.originalName}, ${a.durationSec ? Math.round(a.durationSec) + 's, ' : ''}tags: ${a.tags.join(', ') || 'none'}${a.notes ? `, notes: ${a.notes}` : ''}`)
      .join('\n')
    const posts = recentPosts
      .slice(0, 15)
      .map((p) => `- ${p.status} "${p.title}" ${p.pillar ? `(${p.pillar})` : ''} ${p.postedAt ?? p.scheduledAt ?? ''}`)
      .join('\n')
    const prompt = `Today is ${today}.

ABOUT THE ARTIST
${profileBlock(settings)}

FOOTAGE IN THEIR LIBRARY (most recent first)
${footage || '(nothing imported yet)'}

Most used tags: ${tagCounts.slice(0, 20).map((t) => `${t.tag} (${t.count})`).join(', ') || 'none'}

RECENT AND PLANNED POSTS
${posts || '(none yet)'}

Give ${req.count} fresh content ideas${req.pillar ? ` for the "${req.pillar}" pillar` : ''}${req.focus ? `, focused on: ${req.focus}` : ''}.
Prefer ideas that reuse footage they already have, then ideas they can film in under 30 minutes in the studio. Don't repeat recent posts. Mix the pillars unless one was requested.
For each idea: a short title; the hook (the first line on screen or the first thing said); a description of how to make it in 2 to 4 plain sentences; the format (e.g. "Reel 15-30s", "Carousel 5 photos", "Story poll", "YouTube Short", "Spotify Canvas"); and the pillar it belongs to (one of their pillars).`
    const result = await this.askJson<{ ideas: IdeaDraft[] }>(settings.aiModel, prompt, IDEAS_SCHEMA)
    return result.ideas
  }

  async caption(settings: AppSettings, platform: string, assets: Asset[], post: { title?: string; notes?: string }): Promise<CaptionResult> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = []
    // Show Claude what's in the clip so the caption matches the footage.
    for (const a of assets.slice(0, 4)) {
      if (a.thumbPath && fs.existsSync(a.thumbPath)) {
        content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(a.thumbPath).toString('base64') } })
      }
    }
    const described = assets
      .map((a) => `- ${a.kind}${a.durationSec ? `, ${Math.round(a.durationSec)}s` : ''}, tags: ${a.tags.join(', ') || 'none'}${a.notes ? `, notes: ${a.notes}` : ''}`)
      .join('\n')
    content.push({
      type: 'text',
      text: `ABOUT THE ARTIST
${profileBlock(settings)}

Write a ${platform} caption for this post.
Post title: ${post.title || '(none)'}
What it's about: ${post.notes || '(see the images and tags)'}
Media:
${described || '(no media attached)'}
${content.length > 1 ? 'The images above are frames from the attached media.' : ''}

Rules: open with a line that makes people stop scrolling. Keep it short for ${platform} (Instagram and TikTok: 1 to 3 short lines; YouTube: a title-like first line then 2 lines). Put no hashtags in the caption itself; give 8 to 15 relevant hashtags separately, mixing big genre tags with niche scene tags, without the # sign. ${settings.captionSignature ? `End with this signature line: "${settings.captionSignature}".` : ''}
Also give 2 alternative captions with a different angle.`
    })
    const result = await this.askJson<CaptionResult>(settings.aiModel, content, CAPTION_SCHEMA)
    result.hashtags = result.hashtags.map((h) => h.replace(/^#/, '').replace(/\s+/g, ''))
    return result
  }
}
