import { existsSync } from 'node:fs'
import { readFile, readdir, rename } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { CapShareError } from '../errors'
import { atomicWriteFile, sanitizeFolderName, uniqueName } from '../fsx'
import { DRAFT_COVER_FILENAME } from './constants'
import { asString, findTimelinePath } from './draft'
import { toJsonPath } from './locator'
import { removeRegistryBackup, renameRegistryEntry } from './registry'

export interface UpdateDraftOptions {
  draftRoot: string
  folderPath: string
  draftId: string
  /** New display name. Omit to leave the name (and folder) untouched. */
  newName?: string
  /** New cover image, already encoded as JPEG. Omit to keep the current cover. */
  coverJpeg?: Buffer
  os: 'mac' | 'windows'
}

export interface UpdateDraftResult {
  /** Folder path after the update (changes when a rename moved the folder). */
  folderPath: string
  name: string
}

/**
 * Applies user edits to a draft: replaces draft_cover.jpg and/or renames the
 * project (folder + draft_meta_info.json + registry entry, mirroring what
 * CapCut itself does on rename). A failed meta/registry update renames the
 * folder back so the draft is never left half-moved.
 *
 * Note: CapCut regenerates draft_cover.jpg from the timeline when the draft is
 * next saved in CapCut, so a custom cover is an override until then.
 */
export async function updateDraft(options: UpdateDraftOptions): Promise<UpdateDraftResult> {
  const { draftRoot, draftId, newName, coverJpeg, os } = options

  // Path safety: same direct-child-of-the-draft-root check as deleteDraft.
  const root = resolve(draftRoot)
  const folder = resolve(options.folderPath)
  if (folder === root || folder !== join(root, basename(folder))) {
    throw new CapShareError(
      'DRAFT_NOT_FOUND',
      'Refusing to update: target is not a CapCut project folder inside the draft root.',
      `folder=${folder} root=${root}`
    )
  }
  if (!existsSync(folder)) {
    throw new CapShareError('DRAFT_NOT_FOUND', `Project folder no longer exists: ${folder}`)
  }
  const paths = findTimelinePath(folder)
  if (!paths) {
    throw new CapShareError('DRAFT_NOT_FOUND', `Not a CapCut project (no timeline file): ${folder}`)
  }

  if (coverJpeg) {
    try {
      await atomicWriteFile(join(folder, DRAFT_COVER_FILENAME), coverJpeg)
    } catch (error) {
      throw CapShareError.wrap(error, 'UPDATE_FAILED')
    }
  }

  if (newName === undefined) {
    return { folderPath: folder, name: await readCurrentName(paths.metaPath, folder) }
  }
  return renameDraft({ root, folder, draftId, newName, os, metaPath: paths.metaPath })
}

async function readCurrentName(metaPath: string, folder: string): Promise<string> {
  const meta = await readMeta(metaPath)
  return (meta.parsed && asString(meta.parsed['draft_name'])) ?? basename(folder)
}

async function readMeta(
  metaPath: string
): Promise<{ raw: string | null; parsed: Record<string, unknown> | null }> {
  if (!existsSync(metaPath)) return { raw: null, parsed: null }
  try {
    const raw = await readFile(metaPath, 'utf8')
    return { raw, parsed: JSON.parse(raw) as Record<string, unknown> }
  } catch {
    return { raw: null, parsed: null } // Tolerated: CapCut regenerates sidecar metadata.
  }
}

async function renameDraft(args: {
  root: string
  folder: string
  draftId: string
  newName: string
  os: 'mac' | 'windows'
  metaPath: string
}): Promise<UpdateDraftResult> {
  const { root, folder, draftId, newName, os } = args

  const currentBase = basename(folder)
  const taken = new Set(
    (await readdir(root)).filter((n) => n.toLowerCase() !== currentBase.toLowerCase())
  )
  const sanitized = sanitizeFolderName(newName, os)
  const targetBase = sanitized === currentBase ? currentBase : uniqueName(sanitized, taken)
  const targetFolder = join(root, targetBase)
  const folderMoves = targetBase !== currentBase

  // Capture the meta before moving anything so a rollback can restore it verbatim.
  const meta = await readMeta(args.metaPath)

  if (folderMoves) {
    try {
      await rename(folder, targetFolder)
    } catch (error) {
      throw CapShareError.wrap(error, 'UPDATE_FAILED')
    }
  }

  const rollback = async (): Promise<void> => {
    if (meta.raw !== null) {
      await atomicWriteFile(join(targetFolder, basename(args.metaPath)), meta.raw).catch(() => {})
    }
    if (folderMoves) await rename(targetFolder, folder).catch(() => {})
  }

  try {
    if (meta.parsed && meta.raw !== null) {
      meta.parsed['draft_name'] = newName
      meta.parsed['draft_fold_path'] = toJsonPath(targetFolder)
      await atomicWriteFile(
        join(targetFolder, basename(args.metaPath)),
        JSON.stringify(meta.parsed)
      )
    }

    const timelinePaths = findTimelinePath(targetFolder)
    const { backupPath } = await renameRegistryEntry(root, {
      draftId,
      oldFolderPath: folder,
      newFolderPath: targetFolder,
      draftName: newName,
      timelineFilename: timelinePaths?.timelineFilename ?? 'draft_info.json'
    })
    await removeRegistryBackup(backupPath)
  } catch (error) {
    await rollback()
    throw CapShareError.wrap(error, 'UPDATE_FAILED')
  }

  return { folderPath: targetFolder, name: newName }
}
