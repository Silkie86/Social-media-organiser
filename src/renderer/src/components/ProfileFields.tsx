import type { ArtistProfile } from '@shared/types'

const FIELDS: { key: keyof ArtistProfile; label: string; placeholder: string; long?: boolean }[] = [
  { key: 'artistName', label: 'Artist name', placeholder: 'The name on your flyers' },
  { key: 'genres', label: 'Genres', placeholder: 'e.g. Dubstep, DnB, UK bass, bass house' },
  { key: 'sound', label: 'Your sound and influences', placeholder: 'e.g. Dark rolling halftime, 140, influenced by Mala and Kahn', long: true },
  { key: 'location', label: 'Where you play', placeholder: 'e.g. Bristol and London' },
  { key: 'audience', label: 'Who you want to reach', placeholder: 'e.g. Ravers 20-35, promoters, other producers' },
  { key: 'tone', label: 'How you talk', placeholder: 'e.g. Down to earth, dry humour, no hype words' },
  { key: 'upcoming', label: "What's coming up", placeholder: 'Releases, gigs, radio shows… with dates', long: true },
  { key: 'links', label: 'Links you share', placeholder: 'e.g. Bandcamp, SoundCloud, Linktree' }
]

export function ProfileFields({ value, onChange, only }: { value: ArtistProfile; onChange: (p: ArtistProfile) => void; only?: (keyof ArtistProfile)[] }): React.JSX.Element {
  return (
    <div className="grid-2">
      {FIELDS.filter((f) => !only || only.includes(f.key)).map((f) => (
        <label key={f.key} className={`field ${f.long ? 'span-2' : ''}`}>
          <span>{f.label}</span>
          {f.long ? (
            <textarea rows={2} value={value[f.key]} placeholder={f.placeholder} onChange={(e) => onChange({ ...value, [f.key]: e.target.value })} />
          ) : (
            <input value={value[f.key]} placeholder={f.placeholder} onChange={(e) => onChange({ ...value, [f.key]: e.target.value })} />
          )}
        </label>
      ))}
    </div>
  )
}
