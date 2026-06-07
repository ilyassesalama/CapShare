import { existsSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DraftSummary, TrackSummary, TrackType } from '../../../shared/types'
import { CapShareError } from '../errors'
import { dirSize } from '../fsx'
import {
  DRAFT_COVER_FILENAME,
  DRAFT_META_FILENAME,
  NON_DRAFT_DIR_PATTERN,
  TIMELINE_FILENAMES
} from './constants'
import type { CapCutPlatformBlock, DraftPaths, ParsedDraft } from './model'

/** Locates the timeline JSON inside a draft folder (probes both generations). */
export function findTimelinePath(folder: string): DraftPaths | null {
  for (const filename of TIMELINE_FILENAMES) {
    const candidate = join(folder, filename)
    if (existsSync(candidate)) {
      const coverPath = join(folder, DRAFT_COVER_FILENAME)
      return {
        folder,
        timelinePath: candidate,
        timelineFilename: filename,
        metaPath: join(folder, DRAFT_META_FILENAME),
        coverPath: existsSync(coverPath) ? coverPath : null
      }
    }
  }
  return null
}

/**
 * Reads and parses a draft folder's timeline + metadata.
 * Throws DRAFT_ENCRYPTED for non-JSON timeline content (JianYing 6+ style),
 * DRAFT_UNREADABLE for other parse failures.
 */
export async function parseDraft(folder: string): Promise<ParsedDraft> {
  const paths = findTimelinePath(folder)
  if (!paths) {
    throw new CapShareError(
      'DRAFT_NOT_FOUND',
      `No CapCut timeline file found in ${folder}`,
      `Probed: ${TIMELINE_FILENAMES.join(', ')}`
    )
  }

  const raw = await readFile(paths.timelinePath, 'utf8')
  const head = raw.trimStart()
  if (!head.startsWith('{')) {
    throw new CapShareError(
      'DRAFT_ENCRYPTED',
      'The project file is not plain JSON. CapShare supports CapCut International drafts only (JianYing 6+ drafts are encrypted).'
    )
  }

  let timeline: Record<string, unknown>
  try {
    timeline = JSON.parse(raw) as Record<string, unknown>
  } catch (error) {
    throw new CapShareError(
      'DRAFT_UNREADABLE',
      `Failed to parse ${paths.timelineFilename}`,
      error instanceof Error ? error.message : String(error)
    )
  }

  let meta: Record<string, unknown> | null = null
  if (existsSync(paths.metaPath)) {
    try {
      meta = JSON.parse(await readFile(paths.metaPath, 'utf8')) as Record<string, unknown>
    } catch {
      meta = null // Tolerated: CapCut regenerates sidecar metadata.
    }
  }

  return { paths, timeline, meta }
}

const TRACK_TYPE_MAP: Record<string, TrackType> = {
  video: 'video',
  audio: 'audio',
  text: 'text',
  sticker: 'sticker',
  effect: 'effect',
  filter: 'filter',
  adjust: 'adjust'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Builds a material_id → display label map from the timeline's materials. */
function buildMaterialLabels(materials: Record<string, unknown> | null): Map<string, string> {
  const labels = new Map<string, string>()
  if (!materials) return labels

  for (const video of asArray(materials['videos'])) {
    const rec = asRecord(video)
    const id = rec && asString(rec['id'])
    const name = rec && asString(rec['material_name'])
    if (id && name) labels.set(id, name)
  }
  for (const audio of asArray(materials['audios'])) {
    const rec = asRecord(audio)
    const id = rec && asString(rec['id'])
    const name = rec && asString(rec['name'])
    if (id && name) labels.set(id, name)
  }
  for (const text of asArray(materials['texts'])) {
    const rec = asRecord(text)
    const id = rec && asString(rec['id'])
    if (!id) continue
    // texts[].content is JSON-in-a-string holding the rich text runs.
    const content = rec && asString(rec['content'])
    if (content) {
      try {
        const parsed = JSON.parse(content) as Record<string, unknown>
        const textValue = asString(parsed['text'])
        if (textValue) labels.set(id, textValue.slice(0, 60))
      } catch {}
    }
  }
  return labels
}

function buildTrackSummaries(
  timeline: Record<string, unknown>,
  labels: Map<string, string>
): TrackSummary[] {
  const tracks: TrackSummary[] = []
  for (const track of asArray(timeline['tracks'])) {
    const rec = asRecord(track)
    if (!rec) continue
    const rawType = asString(rec['type']) ?? 'video'
    const type = TRACK_TYPE_MAP[rawType] ?? 'effect'
    const segments: TrackSummary['segments'] = []
    for (const segment of asArray(rec['segments'])) {
      const seg = asRecord(segment)
      if (!seg) continue
      const range = asRecord(seg['target_timerange'])
      const startUs = (range && asNumber(range['start'])) ?? 0
      const durationUs = (range && asNumber(range['duration'])) ?? 0
      const materialId = asString(seg['material_id'])
      segments.push({
        startUs,
        durationUs,
        label: materialId ? labels.get(materialId) : undefined
      })
    }
    if (segments.length > 0) tracks.push({ type, segments })
  }
  return tracks
}

function countMedia(materials: Record<string, unknown> | null): DraftSummary['mediaCounts'] {
  const counts = { video: 0, audio: 0, image: 0 }
  if (!materials) return counts
  for (const video of asArray(materials['videos'])) {
    const rec = asRecord(video)
    if (asString(rec?.['type']) === 'photo') counts.image++
    else counts.video++
  }
  counts.audio = asArray(materials['audios']).length
  return counts
}

async function coverToDataUrl(coverPath: string | null): Promise<string | null> {
  if (!coverPath) return null
  try {
    const data = await readFile(coverPath)
    return `data:image/jpeg;base64,${data.toString('base64')}`
  } catch {
    return null
  }
}

export function getPlatformBlock(
  timeline: Record<string, unknown>,
  key: 'platform' | 'last_modified_platform' = 'platform'
): CapCutPlatformBlock | null {
  const block = asRecord(timeline[key])
  return block ? (block as unknown as CapCutPlatformBlock) : null
}

/** Timeline-only portion of a summary (reused by the exporter for manifests). */
export interface TimelineSummary {
  durationUs: number
  fps: number | null
  canvas: { width: number; height: number } | null
  tracks: TrackSummary[]
  mediaCounts: DraftSummary['mediaCounts']
}

export function summarizeTimeline(timeline: Record<string, unknown>): TimelineSummary {
  const materials = asRecord(timeline['materials'])
  const labels = buildMaterialLabels(materials)
  const canvasRec = asRecord(timeline['canvas_config'])
  const width = canvasRec ? asNumber(canvasRec['width']) : null
  const height = canvasRec ? asNumber(canvasRec['height']) : null

  return {
    durationUs: asNumber(timeline['duration']) ?? 0,
    fps: asNumber(timeline['fps']),
    canvas: width && height ? { width, height } : null,
    tracks: buildTrackSummaries(timeline, labels),
    mediaCounts: countMedia(materials)
  }
}

/** Builds the renderer-facing summary for one draft folder. */
export async function readDraftSummary(folder: string): Promise<DraftSummary> {
  const { paths, timeline, meta } = await parseDraft(folder)

  const summary = summarizeTimeline(timeline)
  const platform =
    getPlatformBlock(timeline) ?? getPlatformBlock(timeline, 'last_modified_platform')

  const createdUs = meta ? asNumber(meta['tm_draft_create']) : null
  const modifiedUs = meta ? asNumber(meta['tm_draft_modified']) : null
  const folderStat = await stat(folder)

  return {
    draftId: (meta && asString(meta['draft_id'])) ?? asString(timeline['id']) ?? paths.folder,
    name:
      (meta && asString(meta['draft_name'])) ??
      asString(timeline['name']) ??
      folder.split(/[\\/]/).pop() ??
      'Untitled',
    folderPath: folder,
    coverDataUrl: await coverToDataUrl(paths.coverPath),
    durationUs: summary.durationUs || (meta ? (asNumber(meta['tm_duration']) ?? 0) : 0),
    fps: summary.fps,
    canvas: summary.canvas,
    sizeBytes: await dirSize(folder),
    createdAt: createdUs ? Math.round(createdUs / 1000) : null,
    modifiedAt: modifiedUs ? Math.round(modifiedUs / 1000) : Math.round(folderStat.mtimeMs),
    tracks: summary.tracks,
    mediaCounts: summary.mediaCounts,
    capcutVersion: platform ? (asString(platform.app_version) ?? null) : null,
    timelineFile: paths.timelineFilename
  }
}

/**
 * Lists all draft summaries under a CapCut draft root.
 * Unreadable drafts are skipped (reported via the warnings array).
 */
export async function listDraftSummaries(
  draftRoot: string
): Promise<{ drafts: DraftSummary[]; warnings: string[] }> {
  const drafts: DraftSummary[] = []
  const warnings: string[] = []

  let entries: string[]
  try {
    entries = await readdir(draftRoot)
  } catch {
    return { drafts, warnings: [`Cannot read draft root: ${draftRoot}`] }
  }

  for (const name of entries.sort()) {
    if (NON_DRAFT_DIR_PATTERN.test(name)) continue
    const folder = join(draftRoot, name)
    try {
      const stats = await stat(folder)
      if (!stats.isDirectory()) continue
      if (!findTimelinePath(folder)) continue
      drafts.push(await readDraftSummary(folder))
    } catch (error) {
      warnings.push(
        `Skipped "${name}": ${error instanceof CapShareError ? error.message : 'unreadable'}`
      )
    }
  }

  drafts.sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0))
  return { drafts, warnings }
}
