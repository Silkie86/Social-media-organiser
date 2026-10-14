import { useState } from 'react'
import type { AppSettings } from '@shared/types'
import { api, useAction } from '../lib'
import { ProfileFields } from '../components/ProfileFields'
import { ClaudeKey } from '../components/ClaudeKey'

export function Onboarding({ initial, onDone }: { initial: AppSettings; onDone: () => void }): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [s, setS] = useState(initial)
  const [busy, run] = useAction()

  const finish = async (): Promise<void> => {
    await run(() => api.updateSettings({ profile: s.profile, libraryRoot: s.libraryRoot, weeklyPostGoal: s.weeklyPostGoal, onboarded: true }))
    onDone()
  }

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <div className="brand big">
          <span className="brand-mark">▮▮▮</span> Crate
        </div>
        {step === 0 && (
          <>
            <h1>Let's get your content sorted</h1>
            <p>
              Crate keeps your camera footage organised, turns clips into the right format for every app, reminds you when to post, and gives you ideas when you're
              stuck. First, a bit about you so the ideas and captions sound like you.
            </p>
            <ProfileFields value={s.profile} onChange={(profile) => setS({ ...s, profile })} only={['artistName', 'genres', 'sound', 'tone']} />
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setStep(1)}>
                Next
              </button>
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <h1>Where should your footage live?</h1>
            <p>Imports are copied here and sorted into a folder per year and per shoot day. Pick a drive with plenty of space, 4K eats storage.</p>
            <div className="row">
              <input className="grow" value={s.libraryRoot} readOnly />
              <button className="btn" onClick={() => api.pickFolder('Choose where to keep your library').then((p) => p && setS({ ...s, libraryRoot: p }))}>
                Change
              </button>
            </div>
            <label className="field">
              <span>How many posts a week are you aiming for?</span>
              <select value={s.weeklyPostGoal} onChange={(e) => setS({ ...s, weeklyPostGoal: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5, 7, 10, 14].map((n) => (
                  <option key={n} value={n}>
                    {n} a week{n === 3 ? ' (a good start)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="modal-actions">
              <button className="btn" onClick={() => setStep(0)}>
                Back
              </button>
              <button className="btn btn-primary" onClick={() => setStep(2)}>
                Next
              </button>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h1>Content ideas from Claude (optional)</h1>
            <ClaudeKey hasKey={s.hasClaudeKey} onSaved={() => api.getSettings().then((n) => setS({ ...s, hasClaudeKey: n.hasClaudeKey }))} />
            <p className="muted">You can skip this and add it later in Settings. Everything else works without it.</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setStep(1)}>
                Back
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={finish}>
                Start using Crate
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
