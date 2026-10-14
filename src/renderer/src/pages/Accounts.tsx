import { useState } from 'react'
import type { PlatformInfo } from '@shared/types'
import { api, fmtDate, useAction, useLoad } from '../lib'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function Accounts(): React.JSX.Element {
  const platforms = useLoad(() => api.listPlatforms())
  return (
    <div className="page">
      <h1>Accounts</h1>
      <p className="muted">
        Connected accounts let Crate show how your posts are doing and find your best times to post. You can plan and export for every platform even before it's
        connected.
      </p>
      {(platforms.data ?? []).map((p) => (
        <PlatformCard key={p.id} platform={p} onChange={platforms.reload} />
      ))}
    </div>
  )
}

function PlatformCard({ platform, onChange }: { platform: PlatformInfo; onChange: () => void }): React.JSX.Element {
  const [busy, run] = useAction()
  const [fields, setFields] = useState<Record<string, string>>({})
  const [showMedia, setShowMedia] = useState(false)

  if (platform.status === 'coming-soon') {
    return (
      <div className="card platform muted-card">
        <div className="row space">
          <h3>{platform.name}</h3>
          <span className="pill">Coming soon</span>
        </div>
        <p className="muted">{platform.connectHelp}</p>
      </div>
    )
  }

  const a = platform.account
  return (
    <div className="card platform">
      <div className="row space">
        <h3>{platform.name}</h3>
        {platform.connected ? <span className="pill pill-posted">Connected</span> : <span className="pill">Not connected</span>}
      </div>
      {platform.connected && a ? (
        <>
          <div className="row wrap">
            <strong>@{a.username}</strong>
            {a.followers != null && <span>{a.followers.toLocaleString()} followers</span>}
            {a.mediaCount != null && <span>{a.mediaCount} posts</span>}
            {a.accountType && <span className="muted">{a.accountType.replace('_', ' ').toLowerCase()} account</span>}
            {a.tokenExpiresAt && <span className="muted small">Access renews automatically (current one valid until {fmtDate(a.tokenExpiresAt)})</span>}
          </div>
          <div className="row">
            <button className="btn" onClick={() => setShowMedia((s) => !s)}>
              {showMedia ? 'Hide recent posts' : 'Recent posts and best times'}
            </button>
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => {
                if (confirm(`Disconnect ${platform.name}? You can reconnect any time.`)) void run(() => api.disconnectPlatform(platform.id)).then(onChange)
              }}
            >
              Disconnect
            </button>
          </div>
          {showMedia && <RecentMedia id={platform.id} />}
        </>
      ) : (
        <>
          <p>{platform.connectHelp}</p>
          {platform.id === 'instagram' && <InstagramSteps />}
          {platform.connectFields.map((f) => (
            <label key={f.key} className="field">
              <span>{f.label}</span>
              <input type={f.secret ? 'password' : 'text'} value={fields[f.key] ?? ''} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })} />
            </label>
          ))}
          <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.connectPlatform(platform.id, fields), `${platform.name} connected`).then((r) => r && onChange())}>
            {busy ? 'Checking…' : `Connect ${platform.name}`}
          </button>
        </>
      )}
    </div>
  )
}

function RecentMedia({ id }: { id: string }): React.JSX.Element {
  const media = useLoad(() => api.platformMedia(id))
  const best = useLoad(() => api.bestTimes(id), [media.data?.length])
  if (media.loading) return <p className="muted">Loading your posts…</p>
  if (media.error) return <p className="error">{media.error}</p>
  return (
    <div>
      {(best.data ?? []).length > 0 && (
        <div className="best-times">
          <h4>When your posts do best</h4>
          <ol>
            {(best.data ?? []).slice(0, 3).map((b, i) => (
              <li key={i}>
                {WEEKDAYS[b.weekday]} {String(b.hour).padStart(2, '0')}:00 to {String(b.hour + 3).padStart(2, '0')}:00{' '}
                <span className="muted">
                  ({b.posts} post{b.posts === 1 ? '' : 's'}, avg {Math.round(b.avgEngagement)} engagement)
                </span>
              </li>
            ))}
          </ol>
          <p className="muted small">Based on likes and comments on your recent posts. It gets more accurate the more you post.</p>
        </div>
      )}
      <div className="ig-grid">
        {(media.data ?? []).map((m) => (
          <button key={m.id} className="ig-item" onClick={() => api.openExternal(m.permalink)} title={m.caption}>
            {m.thumbnailUrl ? <img src={m.thumbnailUrl} alt="" loading="lazy" /> : <div className="thumb-placeholder">{m.mediaType}</div>}
            <div className="ig-stats">
              ♥ {m.likes ?? '–'} · 💬 {m.comments ?? '–'}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function InstagramSteps(): React.JSX.Element {
  return (
    <details className="steps">
      <summary>How to get your Instagram access token (about 15 minutes, once)</summary>
      <ol>
        <li>
          In the Instagram app, go to <em>Settings → Account type and tools → Switch to professional account</em> and pick <em>Creator</em> (if you haven't already). It's
          free and you keep everything.
        </li>
        <li>
          On a computer, go to{' '}
          <button className="link" onClick={() => api.openExternal('https://developers.facebook.com/apps')}>
            developers.facebook.com/apps
          </button>{' '}
          and log in with Facebook. If asked, register as a developer (free).
        </li>
        <li>
          Click <em>Create app</em>. Name it something like "Crate for {'{your name}'}", and when asked what it's for, choose the option for managing messaging and content on
          Instagram.
        </li>
        <li>
          In the app's dashboard, open <em>Instagram → API setup with Instagram login</em>.
        </li>
        <li>
          Under <em>Generate access tokens</em>, click <em>Add account</em>, log in to your Instagram and allow access.
        </li>
        <li>
          Click <em>Generate token</em> next to your account, copy the long token, and paste it below.
        </li>
        <li>
          If Meta says your account isn't allowed yet: in the app dashboard go to <em>App roles → Roles → Add people</em>, add your Instagram username as an{' '}
          <em>Instagram tester</em>, then accept the invite in Instagram under <em>Settings → Website permissions → Tester invites</em>, and try step 5 again.
        </li>
      </ol>
      <p className="muted small">
        Your token is stored encrypted on this computer only. Crate refreshes it automatically so it doesn't expire as long as you open the app at least once every
        couple of months.
      </p>
    </details>
  )
}
