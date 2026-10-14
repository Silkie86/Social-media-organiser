// Domain types shared by the main process (Node) and the renderer (UI).

export type AssetKind = 'video' | 'photo' | 'raw' | 'audio'
export type AssetStatus = 'new' | 'keeper' | 'edited' | 'posted' | 'archived'

export interface Asset {
  id: number
  path: string
  kind: AssetKind
  originalName: string
  size: number
  capturedAt: string // ISO
  importedAt: string
  durationSec: number | null
  width: number | null
  height: number | null
  fps: number | null
  codec: string | null
  camera: string | null
  /** True when the camera recorded in a log profile (e.g. Sony S-Log3) and needs a LUT/grade. */
  isLog: boolean
  shootId: number | null
  rating: number // 0-5
  status: AssetStatus
  notes: string
  thumbPath: string | null
  pairedRawPath: string | null
  tags: string[]
}

export interface Shoot {
  id: number
  name: string
  date: string // YYYY-MM-DD
  folder: string
  assetCount: number
}

export interface LibraryFilter {
  kind?: AssetKind | 'all'
  status?: AssetStatus | 'all'
  tag?: string
  shootId?: number
  minRating?: number
  search?: string
  onlyLog?: boolean
  limit?: number
}

export interface ImportOptions {
  /** Copy into the library folder (recommended) or index files where they are. */
  mode: 'copy' | 'in-place'
  /** Optional name for this shoot, e.g. "Fabric warm-up set". */
  shootName?: string
  /** Rename copied files to start with the capture date and time. */
  renameByDate: boolean
  tags?: string[]
}

export interface ImportProgress {
  jobId: string
  phase: 'scanning' | 'copying' | 'analysing' | 'done' | 'error'
  current: number
  total: number
  file?: string
  imported?: number
  skipped?: number
  error?: string
}

export interface CameraCard {
  root: string
  label: string
  /** e.g. "Sony (XAVC)" when the card has the Sony PRIVATE/M4ROOT layout. */
  camera: string
  videoCount: number
  photoCount: number
  newCount: number
}

// ---- Export / formats ----

export type FitMode = 'fill' | 'blur' | 'fit'

export interface ExportOptions {
  fitMode: FitMode
  /** Seconds into the clip to start. */
  start?: number
  /** Length in seconds; clamped to the preset's maximum. */
  duration?: number
  /** Horizontal crop position for 'fill' mode, -1 (left) .. 0 (centre) .. 1 (right). */
  cropX?: number
  applyLut?: boolean
  normaliseAudio?: boolean
  /** Burned-in text, e.g. "NEW TUNE OUT FRIDAY". */
  overlayText?: string
}

export interface ExportJob {
  id: number
  assetId: number
  presetId: string
  path: string | null
  status: 'queued' | 'running' | 'done' | 'error'
  progress: number
  error: string | null
  createdAt: string
}

export interface ReadinessIssue {
  level: 'ok' | 'fix' | 'block'
  message: string
}

export interface PresetReadiness {
  presetId: string
  /** 'ready' = can upload the original as-is, 'export' = needs an export (we can do it), 'unsupported'. */
  verdict: 'ready' | 'export' | 'unsupported'
  issues: ReadinessIssue[]
}

// ---- Posts / planning ----

export type PostStatus = 'idea' | 'draft' | 'ready' | 'scheduled' | 'posted'

export interface Post {
  id: number
  title: string
  caption: string
  hashtags: string[]
  /** Platform/preset pairs, e.g. [{platform:'instagram', presetId:'ig-reel'}] */
  targets: PostTarget[]
  assetIds: number[]
  scheduledAt: string | null
  status: PostStatus
  postedAt: string | null
  pillar: string | null
  notes: string
  createdAt: string
}

export interface PostTarget {
  platform: string
  presetId: string
  done?: boolean
}

// ---- Ideas ----

export interface Idea {
  id: number
  title: string
  description: string
  format: string
  pillar: string
  hook: string
  status: 'new' | 'saved' | 'used' | 'dismissed'
  source: 'ai' | 'manual'
  createdAt: string
}

export interface IdeaRequest {
  count: number
  focus?: string
  pillar?: string
}

export interface CaptionRequest {
  assetIds: number[]
  platform: string
  notes?: string
  title?: string
}

export interface CaptionResult {
  caption: string
  hashtags: string[]
  alternatives: string[]
}

export interface HashtagSet {
  id: number
  name: string
  tags: string[]
}

// ---- Platforms ----

export interface PlatformInfo {
  id: string
  name: string
  status: 'available' | 'coming-soon'
  connected: boolean
  account: PlatformAccount | null
  capabilities: { readProfile: boolean; readMedia: boolean; publish: boolean }
  /** Short instructions shown on the connect screen. */
  connectHelp: string
  connectFields: { key: string; label: string; secret: boolean }[]
}

export interface PlatformAccount {
  username: string
  displayName?: string
  followers?: number | null
  mediaCount?: number | null
  accountType?: string
  connectedAt: string
  tokenExpiresAt?: string | null
}

export interface PlatformMedia {
  id: string
  caption: string
  mediaType: string
  permalink: string
  thumbnailUrl: string | null
  timestamp: string
  likes: number | null
  comments: number | null
}

export interface BestTimeSlot {
  weekday: number // 0 = Sunday
  hour: number
  avgEngagement: number
  posts: number
}

// ---- Settings ----

export interface ArtistProfile {
  artistName: string
  genres: string
  sound: string
  location: string
  upcoming: string
  audience: string
  tone: string
  links: string
}

export interface AppSettings {
  libraryRoot: string
  profile: ArtistProfile
  weeklyPostGoal: number
  reminderMinutesBefore: number
  dailyNudgeHour: number
  autoDetectCards: boolean
  minimiseToTray: boolean
  startWithSystem: boolean
  lutPath: string
  captionSignature: string
  pillars: string[]
  aiModel: string
  hasClaudeKey: boolean
  onboarded: boolean
}

export interface DashboardSummary {
  postsThisWeek: number
  weeklyGoal: number
  streakWeeks: number
  upcoming: Post[]
  overdue: Post[]
  unsortedCount: number
  newIdeas: number
  readyToPost: number
  lastPostedAt: string | null
  totalAssets: number
}
