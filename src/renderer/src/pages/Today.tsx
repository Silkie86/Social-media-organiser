import type { Post } from '@shared/types'
import { api, fmtDate, useCrateEvent, useLoad, useNav, PLATFORM_LABEL } from '../lib'

export function Today({ onImport }: { onImport: () => void }): React.JSX.Element {
  const nav = useNav()
  const dash = useLoad(() => api.dashboard())
  const settings = useLoad(() => api.getSettings())
  useCrateEvent((e) => e.type === 'library-changed' && dash.reload())
  const d = dash.data
  const name = settings.data?.profile.artistName
  const hour = new Date().getHours()
  const greeting = hour < 5 ? 'Up late' : hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening'
  const daysSince = d?.lastPostedAt ? Math.floor((Date.now() - new Date(d.lastPostedAt).getTime()) / 86_400_000) : null
  const pct = d ? Math.min(1, d.postsThisWeek / Math.max(1, d.weeklyGoal)) : 0

  return (
    <div className="page">
      <h1>
        {greeting}
        {name ? `, ${name}` : ''}
      </h1>
      {dash.error && <p className="error">{dash.error}</p>}
      {d && (
        <>
          <div className="grid-3">
            <div className="card stat">
              <div className="ring" style={{ ['--pct' as string]: `${pct * 360}deg` }}>
                <span>
                  {d.postsThisWeek}/{d.weeklyGoal}
                </span>
              </div>
              <div>
                <div className="stat-label">Posts this week</div>
                <div className="muted">
                  {d.postsThisWeek >= d.weeklyGoal
                    ? 'Goal hit. Anything else is a bonus.'
                    : `${d.weeklyGoal - d.postsThisWeek} to go${d.upcoming.length ? `, ${d.upcoming.length} planned` : ''}.`}
                </div>
              </div>
            </div>
            <div className="card stat">
              <div className="big-number">{d.streakWeeks}</div>
              <div>
                <div className="stat-label">Week streak</div>
                <div className="muted">{daysSince == null ? 'No posts logged yet.' : daysSince === 0 ? 'You posted today.' : `Last post ${daysSince} day${daysSince === 1 ? '' : 's'} ago.`}</div>
              </div>
            </div>
            <div className="card stat">
              <div className="big-number">{d.totalAssets}</div>
              <div>
                <div className="stat-label">Clips and photos</div>
                <div className="muted">{d.unsortedCount ? `${d.unsortedCount} not tagged yet.` : 'All sorted.'}</div>
              </div>
            </div>
          </div>

          <div className="quick-actions">
            <button className="action" onClick={onImport}>
              <strong>Import footage</strong>
              <span>From your ZV-E10 card or any folder</span>
            </button>
            <button className="action" onClick={() => nav.go('ideas')}>
              <strong>Get ideas</strong>
              <span>{d.newIdeas ? `${d.newIdeas} waiting` : 'Fresh ideas from Claude'}</span>
            </button>
            <button className="action" onClick={() => nav.go('planner', { id: -1 })}>
              <strong>Plan a post</strong>
              <span>Caption, files and a time</span>
            </button>
            <button className="action" onClick={() => nav.go('library', {})}>
              <strong>Sort footage</strong>
              <span>{d.unsortedCount ? `${d.unsortedCount} to tag` : 'Browse your library'}</span>
            </button>
          </div>

          {d.overdue.length > 0 && (
            <section>
              <h2 className="warn-text">Missed</h2>
              <PostList posts={d.overdue} />
            </section>
          )}
          <section>
            <h2>Coming up this week</h2>
            {d.upcoming.length ? (
              <PostList posts={d.upcoming} />
            ) : (
              <div className="empty">
                Nothing planned yet.{' '}
                <button className="link" onClick={() => nav.go('ideas')}>
                  Grab an idea
                </button>{' '}
                and schedule it. You'll get a reminder when it's time.
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function PostList({ posts }: { posts: Post[] }): React.JSX.Element {
  const nav = useNav()
  return (
    <div className="list">
      {posts.map((p) => (
        <button key={p.id} className="list-row" onClick={() => nav.go('planner', { id: p.id })}>
          <span className={`pill pill-${p.status}`}>{p.status}</span>
          <strong>{p.title}</strong>
          <span className="muted">{[...new Set(p.targets.map((t) => PLATFORM_LABEL[t.platform] ?? t.platform))].join(', ')}</span>
          <span className="right muted">{fmtDate(p.scheduledAt, true)}</span>
        </button>
      ))}
    </div>
  )
}
