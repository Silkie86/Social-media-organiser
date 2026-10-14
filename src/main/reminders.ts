// Background nudges: post reminders, a daily "you're behind on your goal" nudge, and
// "your camera card is plugged in" detection.

import { Notification } from 'electron'
import type { CameraCard } from '@shared/types'
import type { Planner } from './planner'
import type { Settings } from './settings'
import type { Library } from './library/library'

export class Reminders {
  private timers: NodeJS.Timeout[] = []
  private lastNudgeDay = ''
  private knownCards = new Set<string>()

  constructor(
    private readonly planner: Planner,
    private readonly settings: Settings,
    private readonly library: Library,
    private readonly open: (page: string, id?: number) => void,
    private readonly onCard: (card: CameraCard) => void
  ) {}

  start(): void {
    this.timers.push(setInterval(() => this.checkPosts(), 60_000))
    this.timers.push(setInterval(() => this.checkDailyNudge(), 5 * 60_000))
    this.timers.push(setInterval(() => this.checkCards(), 10_000))
    setTimeout(() => {
      this.checkPosts()
      this.checkCards()
    }, 3000)
  }

  stop(): void {
    this.timers.forEach(clearInterval)
    this.timers = []
  }

  private notify(title: string, body: string, page: string, id?: number): void {
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body })
    n.on('click', () => this.open(page, id))
    n.show()
  }

  private checkPosts(): void {
    const s = this.settings.get()
    for (const post of this.planner.dueForReminder(s.reminderMinutesBefore)) {
      const when = post.scheduledAt ? new Date(post.scheduledAt) : null
      const late = when && when.getTime() < Date.now() - 5 * 60_000
      const time = when?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) ?? ''
      this.notify(
        late ? `Missed: ${post.title}` : `Time to post: ${post.title}`,
        late ? 'This was due earlier. Open Crate to post it or pick a new time.' : `Scheduled for ${time}. Your caption and files are ready to go.`,
        'planner',
        post.id
      )
      this.planner.markReminded(post.id)
    }
  }

  private checkDailyNudge(): void {
    const s = this.settings.get()
    const now = new Date()
    const today = now.toDateString()
    if (now.getHours() < s.dailyNudgeHour || this.lastNudgeDay === today) return
    this.lastNudgeDay = today
    const d = this.planner.dashboard(s.weeklyPostGoal)
    const daysLeft = 7 - ((now.getDay() + 6) % 7) // including today
    const behind = s.weeklyPostGoal - d.postsThisWeek
    if (behind > 0 && behind >= daysLeft - 1 && d.upcoming.length < behind) {
      this.notify(
        `${behind} post${behind === 1 ? '' : 's'} to hit your goal`,
        d.newIdeas > 0 ? `You have ${d.newIdeas} ideas waiting. Pick one and it's done in 10 minutes.` : 'Open Crate for some quick ideas.',
        'ideas'
      )
    } else if (d.unsortedCount >= 20) {
      this.notify('Footage to sort', `${d.unsortedCount} clips haven't been tagged yet. Five minutes now saves digging later.`, 'library')
    }
  }

  private checkCards(): void {
    if (!this.settings.get().autoDetectCards) return
    let present: Set<string>
    let cards: CameraCard[]
    try {
      present = new Set(this.library.cardRoots())
      const fresh = [...present].filter((r) => !this.knownCards.has(r))
      cards = fresh.length ? this.library.detectCards(fresh) : []
    } catch {
      return
    }
    for (const card of cards) {
      this.knownCards.add(card.root)
      if (card.newCount > 0) {
        this.onCard(card)
        this.notify('Camera card found', `${card.newCount} new file${card.newCount === 1 ? '' : 's'} on ${card.label}. Click to import.`, 'library')
      }
    }
    // Forget removed cards so plugging one back in is noticed again.
    for (const root of [...this.knownCards]) if (!present.has(root)) this.knownCards.delete(root)
  }
}
