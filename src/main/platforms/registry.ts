import { comingSoon, type PlatformAdapter } from './types'
import { instagram } from './instagram'

export const PLATFORMS: PlatformAdapter[] = [
  instagram,
  comingSoon('tiktok', 'TikTok', 'TikTok connection is next on the roadmap. Exports for TikTok already work.'),
  comingSoon('youtube', 'YouTube', 'YouTube (Shorts and long videos) is on the roadmap. Exports for YouTube already work.'),
  comingSoon('facebook', 'Facebook', 'Facebook Reels can be cross-posted from Instagram for now.'),
  comingSoon('soundcloud', 'SoundCloud', 'SoundCloud track and stats support is on the roadmap.'),
  comingSoon('x', 'X', 'X support is on the roadmap. Exports for X already work.')
]

export function getPlatform(id: string): PlatformAdapter | undefined {
  return PLATFORMS.find((p) => p.id === id)
}
