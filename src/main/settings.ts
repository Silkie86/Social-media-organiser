// App settings (stored in the database) and secrets such as API keys and access tokens
// (encrypted with the operating system's keychain via Electron's safeStorage).

import fs from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import type { AppSettings } from '@shared/types'
import type { Db } from './db'

export const DEFAULT_PILLARS = [
  'Studio sessions',
  'Mix and live set clips',
  'Release promo',
  'Production tips',
  'Behind the scenes',
  'Gig announcements',
  'Crowd moments',
  'Shout-outs and collabs'
]

function defaults(): Omit<AppSettings, 'hasClaudeKey'> {
  return {
    libraryRoot: path.join(app.getPath('videos'), 'Crate Library'),
    profile: {
      artistName: '',
      genres: 'Bass music',
      sound: '',
      location: '',
      upcoming: '',
      audience: '',
      tone: 'Real, a bit funny, no corporate speak',
      links: ''
    },
    weeklyPostGoal: 3,
    reminderMinutesBefore: 30,
    dailyNudgeHour: 18,
    autoDetectCards: true,
    minimiseToTray: true,
    startWithSystem: false,
    lutPath: '',
    captionSignature: '',
    pillars: DEFAULT_PILLARS,
    aiModel: 'claude-opus-5-5',
    onboarded: false
  }
}

export class Settings {
  private secretsFile = path.join(app.getPath('userData'), 'secrets.json')

  constructor(private readonly db: Db) {}

  get(): AppSettings {
    const stored: Record<string, unknown> = {}
    for (const row of this.db.all<{ key: string; value: string }>('SELECT key, value FROM settings')) {
      try {
        stored[row.key] = JSON.parse(row.value)
      } catch {
        // ignore corrupt values; the default is used instead
      }
    }
    const base = defaults()
    const merged = { ...base, ...stored } as AppSettings
    merged.profile = { ...base.profile, ...(stored.profile as object | undefined) }
    merged.hasClaudeKey = this.hasSecret('claude')
    return merged
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const { hasClaudeKey: _ignored, ...rest } = patch
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(rest)) {
        if (value === undefined) continue
        this.db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
          key,
          JSON.stringify(value)
        ])
      }
    })
    return this.get()
  }

  // ---- secrets ----

  private readSecrets(): Record<string, string> {
    try {
      return JSON.parse(fs.readFileSync(this.secretsFile, 'utf8')) as Record<string, string>
    } catch {
      return {}
    }
  }

  private writeSecrets(all: Record<string, string>): void {
    fs.mkdirSync(path.dirname(this.secretsFile), { recursive: true })
    fs.writeFileSync(this.secretsFile, JSON.stringify(all, null, 2), { mode: 0o600 })
  }

  setSecret(name: string, value: string | null): void {
    const all = this.readSecrets()
    if (value == null || value === '') {
      delete all[name]
    } else if (safeStorage.isEncryptionAvailable()) {
      all[name] = 'enc:' + safeStorage.encryptString(value).toString('base64')
    } else {
      // Some Linux desktops have no keychain; fall back to a file only this user can read.
      all[name] = 'plain:' + Buffer.from(value, 'utf8').toString('base64')
    }
    this.writeSecrets(all)
  }

  getSecret(name: string): string | null {
    const raw = this.readSecrets()[name]
    if (!raw) return null
    try {
      if (raw.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(raw.slice(4), 'base64'))
      if (raw.startsWith('plain:')) return Buffer.from(raw.slice(6), 'base64').toString('utf8')
    } catch {
      return null
    }
    return null
  }

  hasSecret(name: string): boolean {
    return Boolean(this.readSecrets()[name])
  }
}
