import { existsSync } from 'node:fs'
import { copyFile, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from '../fsx'
import { ROOT_META_FILENAME, type TimelineFilename } from './constants'
import { toJsonPath } from './locator'

/**
 * root_meta_info.json is CapCut's recents/registry index. Verified behavior
 * (from CapCut tooling source + our research): CapCut fold-scans the draft
 * directory and back-fills entries for unknown folders, but TRUSTS existing
 * entries without self-correcting them. Therefore:
 *  - registry missing            → skip; CapCut rebuilds it on next launch
 *  - entry for this draft exists → patch it (stale absolute paths are harmful)
 *  - no entry                    → insert a cloned-template entry, draft_ids += 1
 * Every write is preceded by a timestamped backup and applied atomically.
 */

export interface RegistryEntryParams {
  draftId: string
  draftName: string
  /** Absolute (native) path of the draft folder on THIS machine. */
  folderPath: string
  draftRoot: string
  timelineFilename: TimelineFilename
  createUs: number | null
  modifiedUs: number | null
  durationUs: number
  materialsSizeBytes: number
}

interface RegistryFile {
  all_draft_store: Record<string, unknown>[]
  draft_ids: number
  root_path: string
  [key: string]: unknown
}

export interface RegistryUpsertResult {
  action: 'patched' | 'inserted' | 'skipped-missing' | 'skipped-malformed'
  backupPath: string | null
}

/** Full entry shape observed on CapCut 8.7 — defaults for fields we don't know. */
function buildDefaultEntry(): Record<string, unknown> {
  return {
    cloud_draft_cover: false,
    cloud_draft_sync: false,
    draft_cloud_last_action_download: false,
    draft_cloud_purchase_info: '',
    draft_cloud_template_id: '',
    draft_cloud_tutorial_info: '',
    draft_cloud_videocut_purchase_info: '',
    draft_cover: '',
    draft_fold_path: '',
    draft_id: '',
    draft_is_ai_shorts: false,
    draft_is_cloud_temp_draft: false,
    draft_is_invisible: false,
    draft_is_web_article_video: false,
    draft_json_file: '',
    draft_name: '',
    draft_new_version: '',
    draft_root_path: '',
    draft_timeline_materials_size: 0,
    draft_type: '',
    draft_web_article_video_enter_from: '',
    streaming_edit_draft_ready: false,
    tm_draft_cloud_completed: '',
    tm_draft_cloud_entry_id: -1,
    tm_draft_cloud_modified: 0,
    tm_draft_cloud_parent_entry_id: -1,
    tm_draft_cloud_space_id: -1,
    tm_draft_cloud_user_id: -1,
    tm_draft_create: 0,
    tm_draft_modified: 0,
    tm_draft_removed: 0,
    tm_duration: 0
  }
}

function patchEntry(entry: Record<string, unknown>, params: RegistryEntryParams): void {
  const folderJson = toJsonPath(params.folderPath)
  const rootJson = toJsonPath(params.draftRoot)
  entry['draft_id'] = params.draftId
  entry['draft_name'] = params.draftName
  entry['draft_cover'] = `${folderJson}/draft_cover.jpg`
  entry['draft_fold_path'] = folderJson
  entry['draft_json_file'] = `${folderJson}/${params.timelineFilename}`
  entry['draft_root_path'] = rootJson
  entry['draft_timeline_materials_size'] = params.materialsSizeBytes
  entry['tm_draft_create'] = params.createUs ?? Date.now() * 1000
  entry['tm_draft_modified'] = params.modifiedUs ?? Date.now() * 1000
  entry['tm_draft_removed'] = 0
  entry['tm_duration'] = params.durationUs
}

/**
 * Inserts or updates the registry entry for an imported draft.
 * Never throws for malformed registries — those are skipped (CapCut rebuilds).
 */
export async function upsertRegistryEntry(
  draftRoot: string,
  params: RegistryEntryParams
): Promise<RegistryUpsertResult> {
  const registryPath = join(draftRoot, ROOT_META_FILENAME)
  if (!existsSync(registryPath)) {
    return { action: 'skipped-missing', backupPath: null }
  }

  let registry: RegistryFile
  try {
    const parsed = JSON.parse(await readFile(registryPath, 'utf8')) as unknown
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as RegistryFile).all_draft_store)
    ) {
      return { action: 'skipped-malformed', backupPath: null }
    }
    registry = parsed as RegistryFile
  } catch {
    return { action: 'skipped-malformed', backupPath: null }
  }

  const backupPath = `${registryPath}.capshare-backup-${Date.now()}`
  await copyFile(registryPath, backupPath)

  const folderJson = toJsonPath(params.folderPath)
  const existing = registry.all_draft_store.find(
    (entry) =>
      entry['draft_id'] === params.draftId ||
      (typeof entry['draft_fold_path'] === 'string' &&
        toJsonPath(entry['draft_fold_path'] as string).toLowerCase() === folderJson.toLowerCase())
  )

  let action: 'patched' | 'inserted'
  if (existing) {
    patchEntry(existing, params)
    action = 'patched'
  } else {
    const template = registry.all_draft_store[0]
    const entry = template
      ? (JSON.parse(JSON.stringify(template)) as Record<string, unknown>)
      : buildDefaultEntry()
    patchEntry(entry, params)
    registry.all_draft_store.unshift(entry)
    // draft_ids is a COUNT, not a list — verified on the real registry.
    registry.draft_ids = (typeof registry.draft_ids === 'number' ? registry.draft_ids : 0) + 1
    action = 'inserted'
  }

  try {
    await atomicWriteFile(registryPath, JSON.stringify(registry))
  } catch (error) {
    // Restore the backup so the registry is never left half-written.
    await rename(backupPath, registryPath).catch(() => {})
    throw error
  }
  return { action, backupPath }
}

/** Removes a registry backup created by upsertRegistryEntry (post-success). */
export async function removeRegistryBackup(backupPath: string | null): Promise<void> {
  if (backupPath) await rm(backupPath, { force: true })
}

/** Restores the registry from a backup (import rollback path). */
export async function restoreRegistryBackup(
  draftRoot: string,
  backupPath: string | null
): Promise<void> {
  if (!backupPath || !existsSync(backupPath)) return
  await rename(backupPath, join(draftRoot, ROOT_META_FILENAME))
}
