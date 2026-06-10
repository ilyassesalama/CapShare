import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ExportResult } from '../../../shared/types'
import {
  DRAFT_META_FILENAME,
  JUNK_FILE_NAMES,
  REGENERABLE_DIRS,
  TIMELINE_FILENAMES,
  VOLATILE_FILE_PATTERNS
} from '../capcut/constants'
import { asString, findTimelinePath, getPlatformBlock, summarizeTimeline } from '../capcut/draft'
import { toJsonPath } from '../capcut/locator'
import type { CapCutEnv } from '../capcut/model'
import { collectPaths } from '../capcut/scanner'
import { CapShareError } from '../errors'
import { sanitizeFolderName, walkFiles } from '../fsx'
import { ZipWriter } from '../zip'
import {
  CAPSHARE_FORMAT_VERSION,
  COVER_ENTRY_NAME,
  DRAFT_ENTRY_PREFIX,
  EFFECT_ASSET_PREFIX,
  LOOSE_MEDIA_PREFIX,
  MANIFEST_ENTRY_NAME,
  type CapShareManifest
} from './manifest'

export interface ExportDraftOptions {
  draftFolder: string
  env: CapCutEnv
  destinationPath: string
  includeCaches: boolean
  capshareVersion: string
  onProgress?: (processedBytes: number, totalBytes: number, phase: string) => void
  signal?: AbortSignal
  /** Injectable clock for deterministic tests. */
  now?: () => Date
}

interface LoosePlan {
  archivePath: string
  originalPath: string
  fileName: string
  diskPath: string
  size: number
}

interface EffectPlan {
  archivePath: string
  cacheSuffix: string
  diskPath: string
  size: number
}

/**
 * Exports a draft folder into a single .capshare archive.
 *
 * The timeline and meta JSONs are snapshotted into memory up front, so the
 * archive stays internally consistent even if CapCut writes to the draft
 * mid-export (a trailing check downgrades that case to a warning).
 */
export async function exportDraft(options: ExportDraftOptions): Promise<ExportResult> {
  const { draftFolder, env, destinationPath, includeCaches, signal } = options
  const warnings: string[] = []
  const missingAtExport: string[] = []

  const paths = findTimelinePath(draftFolder)
  if (!paths) {
    throw new CapShareError('DRAFT_NOT_FOUND', `No CapCut timeline found in ${draftFolder}`)
  }

  const timelineRaw = await readFile(paths.timelinePath)
  let timeline: Record<string, unknown>
  try {
    timeline = JSON.parse(timelineRaw.toString('utf8')) as Record<string, unknown>
  } catch {
    throw new CapShareError(
      'DRAFT_ENCRYPTED',
      'The project file is not plain JSON — cannot export this draft.'
    )
  }

  let metaRaw: Buffer | null = null
  let meta: Record<string, unknown> | null = null
  if (existsSync(paths.metaPath)) {
    metaRaw = await readFile(paths.metaPath)
    try {
      meta = JSON.parse(metaRaw.toString('utf8')) as Record<string, unknown>
    } catch {
      meta = null
    }
  }

  const draftFolderJson = toJsonPath(draftFolder)
  const scanned = [
    ...collectPaths(timeline, { draftFolderJson }),
    ...(meta ? collectPaths(meta, { draftFolderJson }) : [])
  ]

  const effectPlans = new Map<string, EffectPlan>()
  const loosePlans = new Map<string, LoosePlan>()
  const missingSeen = new Set<string>()
  let looseIndex = 0

  for (const item of scanned) {
    // Provenance-only fields: where media was imported FROM originally. The
    // copies already live in Resources/local — bundling these would duplicate
    // gigabytes and rewrite fields CapCut treats as informational.
    if (item.pointer.includes('draft_materials_copied_info')) continue

    if (item.cls === 'unc') {
      warnings.push(`Network path referenced and not bundled: ${item.normalized}`)
      continue
    }
    if (item.cls === 'effect-cache' && item.cacheSuffix) {
      if (effectPlans.has(item.cacheSuffix)) continue
      // Resolve via this machine's cache dir first (spelling-independent),
      // falling back to the literal path.
      const candidates = [join(env.cacheDir, ...item.cacheSuffix.split('/')), item.normalized]
      const diskPath = candidates.find((p) => existsSync(p))
      if (diskPath) {
        const info = await stat(diskPath)
        if (info.isFile()) {
          effectPlans.set(item.cacheSuffix, {
            archivePath: `${EFFECT_ASSET_PREFIX}${item.cacheSuffix}`,
            cacheSuffix: item.cacheSuffix,
            diskPath,
            size: info.size
          })
        }
      } else {
        warnings.push(
          `Effect asset not in local cache (CapCut will re-download it): ${item.cacheSuffix}`
        )
      }
      continue
    }
    if (item.cls === 'absolute') {
      const key = item.normalized.toLowerCase()
      if (loosePlans.has(key)) continue
      // Only fs-verified files are bundled — classifier hits alone never act.
      if (existsSync(item.normalized)) {
        const info = await stat(item.normalized)
        if (info.isFile()) {
          const fileName = basename(item.normalized)
          looseIndex++
          loosePlans.set(key, {
            archivePath: `${LOOSE_MEDIA_PREFIX}${looseIndex}-${sanitizeFolderName(fileName, 'windows')}`,
            originalPath: item.normalized,
            fileName,
            diskPath: item.normalized,
            size: info.size
          })
        }
      } else if (/\.[A-Za-z0-9]{2,4}$/.test(item.normalized) && !missingSeen.has(key)) {
        missingSeen.add(key)
        missingAtExport.push(item.normalized)
      }
    }
  }

  const timelineNames = new Set<string>(TIMELINE_FILENAMES)
  const leanSkips = new Set<string>(REGENERABLE_DIRS)
  const skip = (relPath: string, isDir: boolean): boolean => {
    if (isDir) {
      return !includeCaches && leanSkips.has(relPath)
    }
    const base = relPath.split('/').pop() ?? relPath
    if (JUNK_FILE_NAMES.has(base)) return true
    if (VOLATILE_FILE_PATTERNS.some((re) => re.test(base))) return true
    if (relPath === DRAFT_META_FILENAME) return true
    if (timelineNames.has(relPath)) return true
    return false
  }

  const draftFiles: { absPath: string; relPath: string; size: number }[] = []
  for await (const file of walkFiles(draftFolder, { skip })) {
    draftFiles.push(file)
  }

  let coverBuffer: Buffer | null = null
  if (paths.coverPath) {
    coverBuffer = await readFile(paths.coverPath)
  }

  const totalBytes =
    timelineRaw.length +
    (metaRaw?.length ?? 0) +
    draftFiles.reduce((sum, f) => sum + f.size, 0) +
    [...effectPlans.values()].reduce((sum, e) => sum + e.size, 0) +
    [...loosePlans.values()].reduce((sum, l) => sum + l.size, 0) +
    (coverBuffer?.length ?? 0)

  let processed = 0
  const onBytes = (n: number): void => {
    processed += n
    options.onProgress?.(processed, totalBytes, 'archive')
  }

  const writer = new ZipWriter(destinationPath, onBytes)
  const integrity: CapShareManifest['integrity'] = {}
  let fileCount = 0

  try {
    const timelineEntry = await writer.add(
      {
        kind: 'file',
        absPath: paths.timelinePath,
        snapshot: timelineRaw,
        zipPath: `${DRAFT_ENTRY_PREFIX}${paths.timelineFilename}`
      },
      signal
    )
    integrity[paths.timelineFilename] = { size: timelineEntry.size, sha256: timelineEntry.sha256 }
    fileCount++

    if (metaRaw) {
      const metaEntry = await writer.add(
        {
          kind: 'file',
          absPath: paths.metaPath,
          snapshot: metaRaw,
          zipPath: `${DRAFT_ENTRY_PREFIX}${DRAFT_META_FILENAME}`
        },
        signal
      )
      integrity[DRAFT_META_FILENAME] = { size: metaEntry.size, sha256: metaEntry.sha256 }
      fileCount++
    }

    for (const file of draftFiles) {
      const entry = await writer.add(
        { kind: 'file', absPath: file.absPath, zipPath: `${DRAFT_ENTRY_PREFIX}${file.relPath}` },
        signal
      )
      integrity[file.relPath] = { size: entry.size, sha256: entry.sha256 }
      fileCount++
    }

    for (const effect of effectPlans.values()) {
      await writer.add(
        { kind: 'file', absPath: effect.diskPath, zipPath: effect.archivePath },
        signal
      )
      fileCount++
    }

    const looseManifest: CapShareManifest['looseMedia'] = []
    for (const loose of loosePlans.values()) {
      const entry = await writer.add(
        { kind: 'file', absPath: loose.diskPath, zipPath: loose.archivePath },
        signal
      )
      looseManifest.push({
        archivePath: loose.archivePath,
        originalPath: loose.originalPath,
        fileName: loose.fileName,
        size: entry.size,
        sha256: entry.sha256
      })
      fileCount++
    }

    if (coverBuffer) {
      await writer.add({ kind: 'buffer', data: coverBuffer, zipPath: COVER_ENTRY_NAME }, signal)
      fileCount++
    }

    // Consistency check: CapCut may have saved while we streamed media.
    const timelineNow = await readFile(paths.timelinePath)
    if (
      createHash('sha256').update(timelineNow).digest('hex') !==
      createHash('sha256').update(timelineRaw).digest('hex')
    ) {
      warnings.push(
        'The project changed while exporting (CapCut saved during the export). The .capshare reflects the project as it was when the export started.'
      )
    }

    const platform =
      getPlatformBlock(timeline) ?? getPlatformBlock(timeline, 'last_modified_platform')
    const project = summarizeTimeline(timeline)
    const manifest: CapShareManifest = {
      formatVersion: CAPSHARE_FORMAT_VERSION,
      source: {
        os: env.os,
        capcutVersion: platform ? (asString(platform.app_version) ?? null) : null,
        newVersion: asString(timeline['new_version']),
        draftId:
          (meta && asString(meta['draft_id'])) ?? asString(timeline['id']) ?? 'unknown-draft-id',
        timelineId: asString(timeline['id']),
        draftName: (meta && asString(meta['draft_name'])) ?? basename(draftFolder),
        timelineFilename: paths.timelineFilename,
        exportedAt: (options.now?.() ?? new Date()).toISOString(),
        capshareVersion: options.capshareVersion
      },
      project: {
        durationUs: project.durationUs,
        fps: project.fps,
        canvas: project.canvas,
        mediaCounts: project.mediaCounts,
        tracks: project.tracks
      },
      contents: { includesCaches: includeCaches, fileCount, totalBytes },
      looseMedia: looseManifest,
      effectAssets: [...effectPlans.values()].map((e) => ({
        archivePath: e.archivePath,
        cacheSuffix: e.cacheSuffix,
        size: e.size
      })),
      integrity,
      missingAtExport,
      warnings
    }

    await writer.add(
      {
        kind: 'buffer',
        data: Buffer.from(JSON.stringify(manifest, null, 2)),
        zipPath: MANIFEST_ENTRY_NAME,
        uncounted: true
      },
      signal
    )
    await writer.finish()
  } catch (error) {
    await rm(destinationPath, { force: true })
    throw CapShareError.wrap(error, 'EXPORT_FAILED')
  }

  const outStat = await stat(destinationPath)
  for (const missing of missingAtExport) {
    warnings.push(`Media file referenced by the project was missing at export: ${missing}`)
  }

  return {
    capsharePath: destinationPath,
    sizeBytes: outStat.size,
    fileCount,
    warnings
  }
}
