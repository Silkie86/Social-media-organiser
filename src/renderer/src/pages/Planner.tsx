import { useEffect, useMemo, useState } from 'react'
import type { Post } from '@shared/types'
import { api, fmtDate, useLoad, PLATFORM_LABEL } from '../lib'
import { PostEditor } from '../components/PostEditor'

function startOfWeek(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7))
  return out
}

export function Planner({ openId, newWithAssets }: { openId?: number; newWithAssets?: number[] }): React.JSX.Element {
  const [weekOffset, setWeekOffset] = useState(0)
  const [editing, setEditing] = useState<Partial<Post> | null>(null)
  const week = useMemo(() => {
    const s = startOfWeek(new Date())
    s.setDate(s.getDate() + weekOffset * 7)
    return s
  }, [weekOffset])
  const weekEnd = new Date(week.getTime() + 7 * 86_400_000)
  const posts = useLoad(() => api.listPosts({ from: week.toISOString(), to: weekEnd.toISOString() }), [week.getTime()])

  useEffect(() => {
    if (openId === -1) setEditing({ title: '', assetIds: newWithAssets ?? [], status: 'draft' })
    else if (openId) void api.listPosts().then((all) => setEditing(all.find((p) => p.id === openId) ?? null))
  }, [openId, newWithAssets])

  const days = Array.from({ length: 7 }, (_, i) => new Date(week.getTime() + i * 86_400_000))
  const all = posts.data ?? []
  const unscheduled = all.filter((p) => !p.scheduledAt && p.status !== 'posted')
  const onDay = (d: Date): Post[] =>
    all.filter((p) => {
      const t = p.scheduledAt ?? p.postedAt
      return t && new Date(t).toDateString() === d.toDateString()
    })

  const newOn = (d: Date): void => {
    const at = new Date(d)
    at.setHours(19, 0, 0, 0)
    setEditing({ title: '', scheduledAt: at.toISOString(), status: 'draft', assetIds: [] })
  }

  return (
    <div className="page wide">
      <div className="page-head">
        <h1>Planner</h1>
        <div className="row">
          <button className="btn" onClick={() => setWeekOffset((w) => w - 1)}>
            ←
          </button>
          <button className="btn" onClick={() => setWeekOffset(0)}>
            This week
          </button>
          <button className="btn" onClick={() => setWeekOffset((w) => w + 1)}>
            →
          </button>
          <button className="btn btn-primary" onClick={() => setEditing({ title: '', status: 'draft', assetIds: [] })}>
            New post
          </button>
        </div>
      </div>
      <p className="muted">
        Week of {fmtDate(week.toISOString())}. Click a day to plan a post for that evening.
      </p>
      <div className="calendar">
        {days.map((d) => {
          const isToday = d.toDateString() === new Date().toDateString()
          return (
            <div key={d.toISOString()} className={`day ${isToday ? 'today' : ''}`}>
              <button className="day-title" onClick={() => newOn(d)} title="Plan a post on this day">
                {d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })} <span className="plus">+</span>
              </button>
              {onDay(d).map((p) => (
                <PostCard key={p.id} post={p} onClick={() => setEditing(p)} />
              ))}
            </div>
          )
        })}
      </div>
      <section>
        <h2>Drafts without a time</h2>
        {unscheduled.length ? (
          <div className="draft-row">
            {unscheduled.map((p) => (
              <PostCard key={p.id} post={p} onClick={() => setEditing(p)} />
            ))}
          </div>
        ) : (
          <p className="muted">None. Ideas you turn into posts land here.</p>
        )}
      </section>
      {editing && (
        <PostEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => posts.reload()}
        />
      )}
    </div>
  )
}

function PostCard({ post, onClick }: { post: Post; onClick: () => void }): React.JSX.Element {
  const time = post.scheduledAt ? new Date(post.scheduledAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null
  return (
    <button className={`post-card status-${post.status}`} onClick={onClick}>
      <div className="post-card-top">
        {time && <span className="muted">{time}</span>}
        <span className={`pill pill-${post.status}`}>{post.status}</span>
      </div>
      <strong>{post.title || 'Untitled'}</strong>
      <span className="muted small">{[...new Set(post.targets.map((t) => PLATFORM_LABEL[t.platform] ?? t.platform))].join(' · ') || 'No platforms yet'}</span>
    </button>
  )
}
