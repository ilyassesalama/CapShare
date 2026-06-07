import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ImportPreview, ImportResult } from '../../../shared/types'
import {
  DRAFT_META_FILENAME,
  DRAFT_PATH_PLACEHOLDER,
  TIMELINE_FILENAME_FOR_OS,
  TIMELINE_FILENAMES,
  VOLATILE_FILE_PATTERNS,
  type TimelineFilename
} from '../capcut/constants'
import { findTimelinePath, getPlatformBlock } from '../capcut/draft'
import { toJsonPath } from '../capcut/locator'
import type { CapCutEnv, CapCutPlatformBlock } from '../capcut/model'
import {
  upsertRegistryEntry,
  removeRegistryBackup,
  restoreRegistryBackup
} from '../capcut/registry'
import { classifyString, walkJsonStrings, normalizeSlashes } from '../capcut/scanner'
import { CapShareError } from '../errors'
import { dirSize, ensureDir, sanitizeFolderName, uniqueName } from '../fsx'
import { extractZip, readZipEntries } from '../zip'
import {
  COVER_ENTRY_NAME,
  DRAFT_ENTRY_PREFIX,
  EFFECT_ASSET_PREFIX,
  MANIFEST_ENTRY_NAME,
  parseManifest,
  type CapShareManifest
} from './manifest'

// --- Inspection ---------------------------------------------------------------

export interface CollisionInfo {
  existingName: string
  existingFolderPath: string
}

/** Light collision probe: folder basenames + per-draft meta draft_ids only. */
export async function findCollision(
  draftRoot: string,
  draftName: string,
  draftId: string,
  os: CapCutEnv['os']
): Promise<CollisionInfo | null> {
  const wantedFolder = sanitizeFolderName(draftName, os).toLowerCase()
  let entries: string[]
  try {
    entries = await readdir(draftRoot)
  } catch {
    return null
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue
    const folder = join(draftRoot, name)
    try {
      if (!(await stat(folder)).isDirectory()) continue
    } catch {
      continue
    }
    if (name.toLowerCase() === wantedFolder) {
      return { existingName: name, existingFolderPath: folder }
    }
    const metaPath = join(folder, DRAFT_META_FILENAME)
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>
        if (meta['draft_id'] === draftId) {
          return { existingName: name, existingFolderPath: folder }
        }
      } catch {
        // Unreadable meta — not a collision signal.
      }
    }
  }
  return null
}

/** Reads manifest + cover and computes collision state for the preview UI. */
export async function inspectCapshare(
  filePath: string,
  env: CapCutEnv | null
): Promise<ImportPreview> {
  let entries: Map<string, Buffer>
  try {
    entries = await readZipEntries(filePath, [MANIFEST_ENTRY_NAME, COVER_ENTRY_NAME])
  } catch (error) {
    throw new CapShareError(
      'ARCHIVE_INVALID',
      'This file is not a readable .capshare archive.',
      error instanceof Error ? error.message : String(error)
    )
  }
  const manifestRaw = entries.get(MANIFEST_ENTRY_NAME)
  if (!manifestRaw) {
    throw new CapShareError(
      'ARCHIVE_INVALID',
      'The archive has no manifest — not a .capshare file.'
    )
  }

  let manifest: CapShareManifest
  try {
    manifest = parseManifest(manifestRaw.toString('utf8'))
  } catch (error) {
    throw new CapShareError(
      'ARCHIVE_INVALID',
      error instanceof Error ? error.message : 'Invalid manifest'
    )
  }

  const cover = entries.get(COVER_ENTRY_NAME)
  const warnings: string[] = [...manifest.warnings]
  if (env && manifest.source.os !== env.os) {
    warnings.push(
      `This project was exported on ${manifest.source.os === 'mac' ? 'macOS' : 'Windows'}. Fonts not installed on this machine will fall back, and online effects may need to re-download.`
    )
  }
  if (manifest.missingAtExport.length > 0) {
    warnings.push(
      `${manifest.missingAtExport.length} media file(s) were already missing when this project was exported.`
    )
  }

  const collision = env
    ? await findCollision(env.draftRoot, manifest.source.draftName, manifest.source.draftId, env.os)
    : null

  return {
    filePath,
    draftName: manifest.source.draftName,
    coverDataUrl: cover ? `data:image/jpeg;base64,${cover.toString('base64')}` : null,
    durationUs: manifest.project.durationUs,
    fps: manifest.project.fps,
    canvas: manifest.project.canvas,
    mediaCount:
      manifest.project.mediaCounts.video +
      manifest.project.mediaCounts.audio +
      manifest.project.mediaCounts.image,
    totalBytes: manifest.contents.totalBytes,
    includesCaches: manifest.contents.includesCaches,
    exportedAt: manifest.source.exportedAt,
    compat: {
      sourceOs: manifest.source.os,
      sourceCapcutVersion: manifest.source.capcutVersion,
      sourceNewVersion: manifest.source.newVersion,
      warnings
    },
    collision
  }
}

// --- Import -------------------------------------------------------------------

export interface ImportCapshareOptions {
  filePath: string
  env: CapCutEnv
  resolution?: 'copy' | 'replace'
  /** Directory OUTSIDE the draft root for replaced-draft backups. */
  backupDir: string
  onProgress?: (processedBytes: number, totalBytes: number, phase: string) => void
  signal?: AbortSignal
  /** Injectable for deterministic tests. */
  uuid?: () => string
}

/**
 * Probes which timeline filename the target machine's CapCut generation
 * expects, by majority vote over existing drafts; falls back to the OS
 * default. Returns `writeBoth` when there is no local evidence.
 */
export async function probeTargetTimelineFilename(
  env: CapCutEnv
): Promise<{ primary: TimelineFilename; writeBoth: boolean }> {
  const counts: Record<TimelineFilename, number> = {
    'draft_info.json': 0,
    'draft_content.json': 0
  }
  try {
    for (const name of await readdir(env.draftRoot)) {
      if (name.startsWith('.')) continue
      const paths = findTimelinePath(join(env.draftRoot, name))
      if (paths) counts[paths.timelineFilename]++
    }
  } catch {
    // No evidence — fall through to OS default.
  }
  const total = counts['draft_info.json'] + counts['draft_content.json']
  if (total === 0) {
    return { primary: TIMELINE_FILENAME_FOR_OS[env.os], writeBoth: true }
  }
  const primary =
    counts['draft_info.json'] >= counts['draft_content.json']
      ? 'draft_info.json'
      : 'draft_content.json'
  return { primary, writeBoth: false }
}

/** Harvests a platform block from any existing draft on the target machine. */
async function harvestDonorPlatform(env: CapCutEnv): Promise<CapCutPlatformBlock | null> {
  let entries: string[]
  try {
    entries = await readdir(env.draftRoot)
  } catch {
    return null
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue
    const paths = findTimelinePath(join(env.draftRoot, name))
    if (!paths) continue
    try {
      const timeline = JSON.parse(await readFile(paths.timelinePath, 'utf8')) as Record<
        string,
        unknown
      >
      const block =
        getPlatformBlock(timeline) ?? getPlatformBlock(timeline, 'last_modified_platform')
      if (block && typeof block.os === 'string') return block
    } catch {
      continue
    }
  }
  return null
}

function synthesizePlatform(
  source: CapCutPlatformBlock | null,
  os: CapCutEnv['os']
): CapCutPlatformBlock {
  return {
    app_id: source?.app_id ?? 359289,
    app_source: source?.app_source ?? 'cc',
    app_version: source?.app_version ?? '',
    device_id: '',
    hard_disk_id: '',
    mac_address: '',
    os,
    os_version: ''
  }
}

interface StagedNames {
  finalName: string
  folderBase: string
  draftId: string
  timelineId: string | null
}

/**
 * Imports a .capshare archive into the target CapCut installation.
 *
 * Everything is staged inside a hidden temp dir in the draft root (same
 * volume → atomic final rename); on any failure the staging dir is removed
 * and — for 'replace' — the original draft is moved back. CapCut directories
 * are only touched in two places: the cache restore (additive, idempotent)
 * and the final rename + registry upsert.
 */
export async function importCapshare(options: ImportCapshareOptions): Promise<ImportResult> {
  const { filePath, env, signal } = options
  const uuid = options.uuid ?? ((): string => randomUUID().toUpperCase())
  const warnings: string[] = []

  const preview = await inspectCapshare(filePath, env)
  const manifestRaw = (await readZipEntries(filePath, [MANIFEST_ENTRY_NAME])).get(
    MANIFEST_ENTRY_NAME
  )!
  const manifest = parseManifest(manifestRaw.toString('utf8'))

  // --- Resolve naming & collision --------------------------------------------
  let finalName = manifest.source.draftName
  let draftId = manifest.source.draftId
  let timelineId: string | null = null // null = keep source timeline id

  const taken = new Set<string>()
  try {
    for (const name of await readdir(env.draftRoot)) taken.add(name)
  } catch {
    // Draft root unreadable → the extract below will fail with a clearer error.
  }

  if (preview.collision) {
    if (!options.resolution) {
      throw new CapShareError(
        'COLLISION_UNRESOLVED',
        `A project named "${preview.collision.existingName}" already exists.`
      )
    }
    if (options.resolution === 'copy') {
      finalName = uniqueName(manifest.source.draftName, taken)
      draftId = uuid()
      timelineId = uuid()
    }
  }

  const folderBase =
    options.resolution === 'copy' && preview.collision
      ? uniqueName(sanitizeFolderName(finalName, env.os), taken)
      : uniqueName(
          sanitizeFolderName(finalName, env.os),
          options.resolution === 'replace' && preview.collision
            ? new Set([...taken].filter((n) => n !== preview.collision!.existingName))
            : taken
        )
  const finalFolder = join(env.draftRoot, folderBase)

  const names: StagedNames = { finalName, folderBase, draftId, timelineId }

  // --- Stage ------------------------------------------------------------------
  const stagingDir = join(env.draftRoot, `.capshare-staging-${Date.now()}`)
  await ensureDir(stagingDir)

  // Loose media: archive entry → Resources/local/<unique name>.
  const looseTargets = new Map<string, { newRel: string; originalPath: string }>()
  const usedLocalNames = new Set<string>()
  for (const loose of manifest.looseMedia) {
    let candidate = sanitizeFolderName(loose.fileName, env.os)
    if (usedLocalNames.has(candidate.toLowerCase())) {
      candidate = `${loose.sha256.slice(0, 8)}-${candidate}`
    }
    usedLocalNames.add(candidate.toLowerCase())
    looseTargets.set(loose.archivePath, {
      newRel: `Resources/local/${candidate}`,
      originalPath: loose.originalPath
    })
  }

  let movedExistingTo: string | null = null
  let registryBackup: string | null = null

  try {
    const totalBytes = manifest.contents.totalBytes
    let processed = 0
    const onBytes = (n: number): void => {
      processed += n
      options.onProgress?.(processed, totalBytes, 'extract')
    }

    await extractZip(filePath, stagingDir, {
      signal,
      onBytes,
      mapEntry: (entryName) => {
        if (entryName.startsWith(DRAFT_ENTRY_PREFIX)) {
          const rel = entryName.slice(DRAFT_ENTRY_PREFIX.length)
          const base = rel.split('/').pop() ?? rel
          // Defense in depth: never materialize volatile/backup files.
          if (VOLATILE_FILE_PATTERNS.some((re) => re.test(base))) return null
          return rel
        }
        const loose = looseTargets.get(entryName)
        if (loose) return loose.newRel
        return null // manifest / cover / effect assets handled separately
      }
    })

    // --- Rewrite the staged draft ---------------------------------------------
    const stagedPaths = findTimelinePath(stagingDir)
    if (!stagedPaths) {
      throw new CapShareError('ARCHIVE_INVALID', 'Archive contains no timeline file.')
    }
    const timeline = JSON.parse(await readFile(stagedPaths.timelinePath, 'utf8')) as Record<
      string,
      unknown
    >
    let meta: Record<string, unknown> | null = null
    if (existsSync(stagedPaths.metaPath)) {
      meta = JSON.parse(await readFile(stagedPaths.metaPath, 'utf8')) as Record<string, unknown>
    }

    // The SOURCE machine's draft folder spelling — for draft-internal rewrites.
    const sourceFolderJson =
      meta && typeof meta['draft_fold_path'] === 'string'
        ? normalizeSlashes(meta['draft_fold_path'] as string)
        : null

    const looseByOriginal = new Map<string, string>()
    for (const { newRel, originalPath } of looseTargets.values()) {
      looseByOriginal.set(normalizeSlashes(originalPath).toLowerCase(), newRel)
    }

    const rewriteValue =
      (style: 'placeholder' | 'relative') =>
      (value: string): string | undefined => {
        const result = classifyString(value, { draftFolderJson: sourceFolderJson })
        if (result.cls === 'effect-cache' && result.cacheSuffix) {
          return `${env.canonicalCacheDirJson}/${result.cacheSuffix}`
        }
        if (result.cls === 'draft-internal' && result.draftRelative) {
          return style === 'placeholder'
            ? `${DRAFT_PATH_PLACEHOLDER}/${result.draftRelative}`
            : `./${result.draftRelative}`
        }
        if (result.cls === 'absolute' || result.cls === 'unc') {
          const looseRel = looseByOriginal.get(result.normalized.toLowerCase())
          if (looseRel) {
            return style === 'placeholder'
              ? `${DRAFT_PATH_PLACEHOLDER}/${looseRel}`
              : `./${looseRel}`
          }
        }
        return undefined
      }

    walkJsonStrings(timeline, rewriteValue('placeholder'))
    if (meta) walkJsonStrings(meta, rewriteValue('relative'))

    // Platform identity → this machine (fixes the cross-machine "unusual path" error).
    const donor = await harvestDonorPlatform(env)
    const sourcePlatform = getPlatformBlock(timeline)
    const targetPlatform = donor ?? synthesizePlatform(sourcePlatform, env.os)
    if (donor === null) {
      warnings.push(
        'No existing CapCut project found to harvest machine identity from — synthesized one. If CapCut reports an "unusual path" error, create any empty project once and re-import.'
      )
    }
    timeline['platform'] = { ...targetPlatform }
    timeline['last_modified_platform'] = { ...targetPlatform }

    if (names.timelineId) timeline['id'] = names.timelineId

    const finalFolderJson = toJsonPath(finalFolder)
    if (meta) {
      meta['draft_id'] = names.draftId
      meta['draft_name'] = names.finalName
      meta['draft_fold_path'] = finalFolderJson
      meta['draft_root_path'] = toJsonPath(env.draftRoot)
      meta['draft_removable_storage_device'] = ''

      // Record where relocated loose media came from.
      const copiedInfo = Array.isArray(meta['draft_materials_copied_info'])
        ? (meta['draft_materials_copied_info'] as Record<string, unknown>[])
        : []
      for (const { newRel, originalPath } of looseTargets.values()) {
        copiedInfo.push({ dst_path: newRel, src_path: originalPath })
      }
      meta['draft_materials_copied_info'] = copiedInfo
    }

    // --- Timeline filename for the target generation ---------------------------
    const probe = await probeTargetTimelineFilename(env)
    const timelineJson = JSON.stringify(timeline)
    await writeFile(join(stagingDir, probe.primary), timelineJson)
    if (probe.writeBoth) {
      const secondary = TIMELINE_FILENAMES.find((n) => n !== probe.primary)!
      await writeFile(join(stagingDir, secondary), timelineJson)
    } else if (stagedPaths.timelineFilename !== probe.primary) {
      await rm(join(stagingDir, stagedPaths.timelineFilename), { force: true })
    }
    if (meta) {
      await writeFile(join(stagingDir, DRAFT_META_FILENAME), JSON.stringify(meta))
    }

    // --- Restore effect-cache assets (additive, idempotent) --------------------
    if (manifest.effectAssets.length > 0) {
      await extractZip(filePath, env.cacheDir, {
        signal,
        onBytes,
        mapEntry: (entryName) => {
          if (!entryName.startsWith(EFFECT_ASSET_PREFIX)) return null
          const suffix = entryName.slice(EFFECT_ASSET_PREFIX.length)
          // Never overwrite existing cache files.
          return existsSync(join(env.cacheDir, ...suffix.split('/'))) ? null : suffix
        }
      })
    }

    // --- Swap into place --------------------------------------------------------
    if (preview.collision && options.resolution === 'replace') {
      await ensureDir(options.backupDir)
      movedExistingTo = join(options.backupDir, `${preview.collision.existingName}-${Date.now()}`)
      await rename(preview.collision.existingFolderPath, movedExistingTo)
      warnings.push(`The previous version was backed up to: ${movedExistingTo}`)
    }

    await rename(stagingDir, finalFolder)

    // --- Registry (best-effort; scan discovery is the fallback) ----------------
    try {
      const metaCreate =
        meta && typeof meta['tm_draft_create'] === 'number'
          ? (meta['tm_draft_create'] as number)
          : null
      const metaModified =
        meta && typeof meta['tm_draft_modified'] === 'number'
          ? (meta['tm_draft_modified'] as number)
          : null
      const result = await upsertRegistryEntry(env.draftRoot, {
        draftId: names.draftId,
        draftName: names.finalName,
        folderPath: finalFolder,
        draftRoot: env.draftRoot,
        timelineFilename: probe.primary,
        createUs: metaCreate,
        modifiedUs: metaModified,
        durationUs: manifest.project.durationUs,
        materialsSizeBytes: await dirSize(join(finalFolder, 'Resources')).catch(() => 0)
      })
      registryBackup = result.backupPath
      await removeRegistryBackup(registryBackup)
      registryBackup = null
    } catch {
      await restoreRegistryBackup(env.draftRoot, registryBackup)
      warnings.push(
        'Could not update the CapCut project registry — CapCut will discover the project on its next launch.'
      )
    }
  } catch (error) {
    // Roll back: remove staging; if we already moved the old draft out, put it back.
    await rm(stagingDir, { recursive: true, force: true })
    if (movedExistingTo && preview.collision) {
      await rename(movedExistingTo, preview.collision.existingFolderPath).catch(() => {})
    }
    throw CapShareError.wrap(error, 'IMPORT_FAILED')
  }

  // --- Post-verify --------------------------------------------------------------
  try {
    const finalPaths = findTimelinePath(finalFolder)
    if (finalPaths) {
      const finalTimeline = JSON.parse(await readFile(finalPaths.timelinePath, 'utf8')) as Record<
        string,
        unknown
      >
      let foreign = 0
      walkJsonStrings(finalTimeline, (value) => {
        const cls = classifyString(value).cls
        if (cls === 'absolute' || cls === 'unc') foreign++
        if (
          cls === 'effect-cache' &&
          !normalizeSlashes(value).startsWith(env.canonicalCacheDirJson)
        ) {
          foreign++
        }
        return undefined
      })
      if (foreign > 0) {
        warnings.push(
          `${foreign} path reference(s) could not be relocated; CapCut may ask to relink those files.`
        )
      }
    }
  } catch {
    // Verification is best-effort.
  }

  return { draftName: names.finalName, folderPath: finalFolder, warnings }
}
