import type { TimelineFilename } from './constants'

/** Which CapCut platform a draft root belongs to. */
export type CapCutOs = 'mac' | 'windows'

/**
 * A resolved CapCut installation environment on a machine.
 * All paths are absolute and use the platform's native separators for fs
 * operations; values written into draft JSON are converted to forward slashes.
 */
export interface CapCutEnv {
  os: CapCutOs
  /** .../User Data — parent of Projects/ and Cache/. */
  userDataDir: string
  /** .../User Data/Projects/com.lveditor.draft */
  draftRoot: string
  /** .../User Data/Cache */
  cacheDir: string
  /**
   * The cache-dir spelling CapCut itself writes into draft JSON on this
   * machine (forward slashes; on macOS this is the sandbox-container form).
   */
  canonicalCacheDirJson: string
  /** True when the draft root was supplied by the user instead of detected. */
  fromOverride: boolean
}

/** Locations of the well-known files inside one draft folder. */
export interface DraftPaths {
  folder: string
  /** Absolute path of the timeline JSON that exists in this draft. */
  timelinePath: string
  timelineFilename: TimelineFilename
  metaPath: string
  coverPath: string | null
}

/** Raw parsed draft JSONs plus their locations. */
export interface ParsedDraft {
  paths: DraftPaths
  /** Parsed timeline (draft_info.json / draft_content.json). */
  timeline: Record<string, unknown>
  /** Parsed draft_meta_info.json (null when missing/corrupt). */
  meta: Record<string, unknown> | null
}

/** The platform block CapCut embeds in timelines (`platform` / `last_modified_platform`). */
export interface CapCutPlatformBlock {
  app_id: number
  app_source: string
  app_version: string
  device_id: string
  hard_disk_id: string
  mac_address: string
  os: string
  os_version: string
  [key: string]: unknown
}
