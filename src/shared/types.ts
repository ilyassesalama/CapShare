/**
 * DTOs shared between the main and renderer processes.
 * This module must stay dependency-free and importable from both sides.
 */

export type TrackType = 'video' | 'audio' | 'text' | 'sticker' | 'effect' | 'filter' | 'adjust'

export interface TrackSegmentSummary {
  /** Start of the segment on the timeline, in microseconds. */
  startUs: number
  /** Duration of the segment on the timeline, in microseconds. */
  durationUs: number
  /** Display label resolved from the referenced material (e.g. file name). */
  label?: string
}

export interface TrackSummary {
  type: TrackType
  segments: TrackSegmentSummary[]
}

export interface DraftSummary {
  /** CapCut meta/registry draft id (uppercase UUID). */
  draftId: string
  /** Display name of the project. */
  name: string
  /** Absolute path of the draft folder on this machine. */
  folderPath: string
  /** Cover image as a data URL, when draft_cover.jpg exists. */
  coverDataUrl: string | null
  durationUs: number
  fps: number | null
  canvas: { width: number; height: number } | null
  /** Total size of the draft folder in bytes. */
  sizeBytes: number
  /** Unix ms timestamps. */
  createdAt: number | null
  modifiedAt: number | null
  tracks: TrackSummary[]
  mediaCounts: { video: number; audio: number; image: number }
  /** CapCut app version that last wrote the draft (platform.app_version). */
  capcutVersion: string | null
  /** Which timeline filename this draft uses (draft_info.json / draft_content.json). */
  timelineFile: string
}

export interface ProgressEvent {
  /** Correlates progress with the operation that emitted it. */
  taskId: string
  phase: string
  processedBytes: number
  totalBytes: number
  /** 0..1 convenience value. */
  ratio: number
}

export interface ExportRequest {
  draftId: string
  destinationPath: string
  includeCaches: boolean
}

export interface ExportResult {
  capsharePath: string
  sizeBytes: number
  fileCount: number
  warnings: string[]
}

export interface ImportCompat {
  sourceOs: 'mac' | 'windows'
  sourceCapcutVersion: string | null
  sourceNewVersion: string | null
  warnings: string[]
}

export interface ImportPreview {
  filePath: string
  draftName: string
  coverDataUrl: string | null
  durationUs: number
  fps: number | null
  canvas: { width: number; height: number } | null
  mediaCount: number
  totalBytes: number
  includesCaches: boolean
  exportedAt: string
  compat: ImportCompat
  /** Set when a draft with the same name or id already exists on this machine. */
  collision: { existingName: string; existingFolderPath: string } | null
}

export type CollisionResolution = 'copy' | 'replace'

export interface ImportRequest {
  filePath: string
  /** Required when the preview reported a collision. */
  resolution?: CollisionResolution
}

export interface ImportResult {
  draftName: string
  folderPath: string
  warnings: string[]
}

export interface AppSettings {
  /** Override for the CapCut draft root; null = auto-detect. */
  draftRootOverride: string | null
  defaultExportDir: string | null
  includeCachesByDefault: boolean
  theme: 'system' | 'light' | 'dark'
}

/** Envelope for all invoke-style IPC results (errors cross the bridge intact). */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: CapShareErrorShape }

export interface ProjectsResponse {
  /** False when no CapCut installation/draft root was found. */
  found: boolean
  draftRoot: string | null
  os: 'mac' | 'windows' | null
  drafts: DraftSummary[]
  warnings: string[]
}

export interface CapShareErrorShape {
  code:
    | 'CAPCUT_NOT_FOUND'
    | 'DRAFT_NOT_FOUND'
    | 'DRAFT_UNREADABLE'
    | 'DRAFT_ENCRYPTED'
    | 'EXPORT_FAILED'
    | 'EXPORT_CHANGED_DURING'
    | 'ARCHIVE_INVALID'
    | 'IMPORT_FAILED'
    | 'COLLISION_UNRESOLVED'
    | 'CANCELLED'
    | 'UNKNOWN'
  message: string
  detail?: string
}
