// Instagram, via Meta's official "Instagram API with Instagram Login". Works with
// Professional (Creator or Business) accounts. See docs/INSTAGRAM_SETUP.md.

import type { PlatformAccount, PlatformMedia } from '@shared/types'
import type { ConnectResult, PlatformAdapter, PlatformCredentials } from './types'

const GRAPH = 'https://graph.instagram.com'
const DAY = 24 * 60 * 60 * 1000

interface IgError {
  error?: { message?: string; code?: number; type?: string }
}

async function igGet<T>(pathname: string, params: Record<string, string>): Promise<T> {
  const url = new URL(GRAPH + pathname)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new Error('Could not reach Instagram. Check your internet connection.')
  }
  const body = (await res.json().catch(() => ({}))) as T & IgError
  if (!res.ok || body.error) {
    const msg = body.error?.message ?? `Instagram returned ${res.status}`
    if (body.error?.code === 190) throw new Error('Instagram says this access token is invalid or expired. Generate a new one and connect again.')
    throw new Error(msg)
  }
  return body
}

interface IgProfile {
  user_id?: string
  id: string
  username: string
  name?: string
  account_type?: string
  followers_count?: number
  media_count?: number
}

async function fetchProfile(token: string): Promise<IgProfile> {
  return igGet<IgProfile>('/me', {
    fields: 'user_id,username,name,account_type,followers_count,media_count',
    access_token: token
  })
}

function toAccount(p: IgProfile, connectedAt: string, expiresAt: string | null): PlatformAccount {
  return {
    username: p.username,
    displayName: p.name,
    followers: p.followers_count ?? null,
    mediaCount: p.media_count ?? null,
    accountType: p.account_type,
    connectedAt,
    tokenExpiresAt: expiresAt
  }
}

/** Long-lived tokens last 60 days and can be refreshed once they are at least a day old. */
async function refreshToken(token: string): Promise<{ token: string; expiresAt: string | null }> {
  const r = await igGet<{ access_token: string; expires_in?: number }>('/refresh_access_token', {
    grant_type: 'ig_refresh_token',
    access_token: token
  })
  return { token: r.access_token, expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000).toISOString() : null }
}

export const instagram: PlatformAdapter = {
  id: 'instagram',
  name: 'Instagram',
  status: 'available',
  capabilities: { readProfile: true, readMedia: true, publish: false },
  connectHelp:
    'Needs a Professional (Creator or Business) Instagram account and an access token from a Meta developer app. The step-by-step guide is in the Help link below.',
  connectFields: [{ key: 'token', label: 'Instagram access token', secret: true }],

  async connect(fields): Promise<ConnectResult> {
    const token = (fields.token ?? '').trim()
    if (!token) throw new Error('Paste your Instagram access token first.')
    const profile = await fetchProfile(token)
    let creds: PlatformCredentials = { token, extra: { userId: profile.user_id ?? profile.id } }
    let expiresAt: string | null = new Date(Date.now() + 60 * DAY).toISOString()
    try {
      const r = await refreshToken(token)
      creds = { ...creds, token: r.token }
      expiresAt = r.expiresAt
    } catch {
      // Brand-new tokens can't be refreshed for 24 hours; the existing one still works.
    }
    return { account: toAccount(profile, new Date().toISOString(), expiresAt), credentials: creds }
  },

  async refresh(creds, account): Promise<ConnectResult> {
    let token = creds.token
    let expiresAt = account.tokenExpiresAt ?? null
    const msLeft = expiresAt ? new Date(expiresAt).getTime() - Date.now() : 0
    if (msLeft < 50 * DAY) {
      try {
        const r = await refreshToken(token)
        token = r.token
        expiresAt = r.expiresAt
      } catch {
        // keep using the current token until it actually fails
      }
    }
    const profile = await fetchProfile(token)
    return { account: toAccount(profile, account.connectedAt, expiresAt), credentials: { ...creds, token } }
  },

  async recentMedia(creds): Promise<PlatformMedia[]> {
    const r = await igGet<{
      data: {
        id: string
        caption?: string
        media_type: string
        media_product_type?: string
        permalink: string
        thumbnail_url?: string
        media_url?: string
        timestamp: string
        like_count?: number
        comments_count?: number
      }[]
    }>('/me/media', {
      fields: 'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count',
      limit: '50',
      access_token: creds.token
    })
    return r.data.map((m) => ({
      id: m.id,
      caption: m.caption ?? '',
      mediaType: m.media_product_type === 'REELS' ? 'REEL' : m.media_type,
      permalink: m.permalink,
      thumbnailUrl: m.thumbnail_url ?? (m.media_type === 'VIDEO' ? null : (m.media_url ?? null)),
      timestamp: m.timestamp,
      likes: m.like_count ?? null,
      comments: m.comments_count ?? null
    }))
  }
}
