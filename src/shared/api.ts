// The contract between the UI and the main process. Every method here is exposed to the
// renderer as window.crate.<method>() and implemented in src/main/ipc.ts. Adding a feature
// means adding a method here, implementing it there, and calling it from the UI.

import type {
  AppSettings, Asset, AssetStatus, BestTimeSlot, CameraCard, CaptionRequest, CaptionResult,
  DashboardSummary, ExportJob, ExportOptions, HashtagSet, Idea, IdeaRequest, ImportOptions,
  LibraryFilter, PlatformInfo, PlatformMedia, Post, PresetReadiness, Shoot
} from './types'
import type { FormatPreset } from './formats'

export interface CrateApi {
  // Settings
  getSettings(): Promise<AppSettings>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  setClaudeKey(key: string): Promise<{ ok: boolean; error?: string }>
  pickFolder(title?: string): Promise<string | null>
  pickFile(title: string, extensions: string[]): Promise<string | null>
  openExternal(url: string): Promise<void>
  revealInFolder(path: string): Promise<void>
  copyText(text: string): Promise<void>

  // Library
  listAssets(filter: LibraryFilter): Promise<Asset[]>
  getAsset(id: number): Promise<Asset | null>
  updateAsset(id: number, patch: { rating?: number; status?: AssetStatus; notes?: string; isLog?: boolean }): Promise<Asset | null>
  setAssetTags(ids: number[], tags: string[], mode: 'replace' | 'add'): Promise<void>
  removeAssets(ids: number[]): Promise<void>
  listTags(): Promise<{ tag: string; count: number }[]>
  listShoots(): Promise<Shoot[]>
  renameShoot(id: number, name: string): Promise<void>
  detectCards(): Promise<CameraCard[]>
  importFrom(path: string | null, options: ImportOptions): Promise<{ jobId: string } | null>

  // Export / formats
  listPresets(): Promise<FormatPreset[]>
  checkReadiness(assetId: number): Promise<PresetReadiness[]>
  queueExports(assetId: number, presetIds: string[], options: Partial<ExportOptions>): Promise<ExportJob[]>
  listExports(assetId?: number): Promise<ExportJob[]>
  ffmpegAvailable(): Promise<boolean>

  // Posts
  listPosts(range?: { from: string; to: string }): Promise<Post[]>
  savePost(post: Partial<Post> & { title: string }): Promise<Post>
  deletePost(id: number): Promise<void>
  /** Copies the caption, opens the folder of ready files, and returns what was done. */
  openPublishKit(id: number, platform: string): Promise<{ copied: boolean; folder: string | null; missing: string[] }>
  markPosted(id: number, platform?: string): Promise<Post>
  /** Queues exports for every attached file and every target format that isn't ready yet. */
  preparePostFiles(id: number): Promise<{ queued: number }>
  dashboard(): Promise<DashboardSummary>

  // Ideas and AI
  listIdeas(status?: Idea['status']): Promise<Idea[]>
  generateIdeas(req: IdeaRequest): Promise<Idea[]>
  updateIdea(id: number, patch: Partial<Pick<Idea, 'status' | 'title' | 'description'>>): Promise<void>
  ideaToPost(id: number): Promise<Post>
  writeCaption(req: CaptionRequest): Promise<CaptionResult>
  listHashtagSets(): Promise<HashtagSet[]>
  saveHashtagSet(set: { id?: number; name: string; tags: string[] }): Promise<HashtagSet>
  deleteHashtagSet(id: number): Promise<void>

  // Platforms
  listPlatforms(): Promise<PlatformInfo[]>
  connectPlatform(id: string, fields: Record<string, string>): Promise<PlatformInfo>
  disconnectPlatform(id: string): Promise<void>
  platformMedia(id: string): Promise<PlatformMedia[]>
  bestTimes(id: string): Promise<BestTimeSlot[]>
}

export type CrateEvent =
  | { type: 'import-progress'; payload: import('./types').ImportProgress }
  | { type: 'export-progress'; payload: ExportJob }
  | { type: 'card-detected'; payload: CameraCard }
  | { type: 'navigate'; payload: { page: string; id?: number } }
  | { type: 'library-changed'; payload: null }

// A record (not a list) so TypeScript fails the build if a method is missing here.
const METHOD_MAP: Record<keyof CrateApi, true> = {
  getSettings: true,
  updateSettings: true,
  setClaudeKey: true,
  pickFolder: true,
  pickFile: true,
  openExternal: true,
  revealInFolder: true,
  copyText: true,
  listAssets: true,
  getAsset: true,
  updateAsset: true,
  setAssetTags: true,
  removeAssets: true,
  listTags: true,
  listShoots: true,
  renameShoot: true,
  detectCards: true,
  importFrom: true,
  listPresets: true,
  checkReadiness: true,
  queueExports: true,
  listExports: true,
  ffmpegAvailable: true,
  listPosts: true,
  savePost: true,
  deletePost: true,
  openPublishKit: true,
  markPosted: true,
  preparePostFiles: true,
  dashboard: true,
  listIdeas: true,
  generateIdeas: true,
  updateIdea: true,
  ideaToPost: true,
  writeCaption: true,
  listHashtagSets: true,
  saveHashtagSet: true,
  deleteHashtagSet: true,
  listPlatforms: true,
  connectPlatform: true,
  disconnectPlatform: true,
  platformMedia: true,
  bestTimes: true
}

export const API_METHODS = Object.keys(METHOD_MAP) as (keyof CrateApi)[]
