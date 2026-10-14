// Every social platform is an adapter with the same shape. To add one (TikTok, YouTube,
// SoundCloud...), implement PlatformAdapter in a new file and add it to registry.ts.

import type { PlatformAccount, PlatformMedia } from '@shared/types'

export interface PlatformCredentials {
  /** Long-lived access token or similar. Stored encrypted. */
  token: string
  /** Anything else the platform needs, e.g. a user id. */
  extra?: Record<string, string>
}

export interface ConnectResult {
  account: PlatformAccount
  credentials: PlatformCredentials
}

export interface PlatformAdapter {
  id: string
  name: string
  status: 'available' | 'coming-soon'
  capabilities: { readProfile: boolean; readMedia: boolean; publish: boolean }
  connectHelp: string
  connectFields: { key: string; label: string; secret: boolean }[]

  /** Validates what the user typed and returns the account plus credentials to store. */
  connect(fields: Record<string, string>): Promise<ConnectResult>
  /** Refreshes the profile, and the token if it is close to expiring. */
  refresh?(creds: PlatformCredentials, account: PlatformAccount): Promise<ConnectResult>
  recentMedia?(creds: PlatformCredentials): Promise<PlatformMedia[]>
  /** Direct publishing. Not every platform allows it for desktop apps. */
  publish?(creds: PlatformCredentials, input: { mediaUrl: string; caption: string; kind: 'image' | 'reel' }): Promise<{ id: string; permalink?: string }>
}

export function comingSoon(id: string, name: string, help: string): PlatformAdapter {
  return {
    id,
    name,
    status: 'coming-soon',
    capabilities: { readProfile: false, readMedia: false, publish: false },
    connectHelp: help,
    connectFields: [],
    connect: () => Promise.reject(new Error(`${name} is not connected yet. You can still export files and plan posts for it.`))
  }
}
