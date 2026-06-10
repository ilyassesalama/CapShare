import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { CapShareError } from '../errors'
import { findTimelinePath } from './draft'
import { removeRegistryBackup, removeRegistryEntry, restoreRegistryBackup } from './registry'

export interface DeleteDraftOptions {
  draftRoot: string
  folderPath: string
  draftId: string
  /** Sends the folder to the OS Trash/Recycle Bin. Injected so this module stays electron-free. */
  trashFolder: (absPath: string) => Promise<void>
}

/**
 * Removes a CapCut draft: scrubs its registry entry (reversible) then moves its
 * folder to the OS Trash. Registry removal goes FIRST because CapCut back-fills
 * unknown folders — a "registry entry gone, folder still present" state
 * self-heals on CapCut's next scan, whereas "folder gone, entry still present"
 * is the harmful ghost (CapCut trusts existing entries). If the trash step
 * fails, the registry backup is restored and the error rethrown.
 */
export async function deleteDraft(options: DeleteDraftOptions): Promise<void> {
  const { draftRoot, folderPath, draftId, trashFolder } = options

  // Path safety: the target must be a DIRECT CHILD of the draft root (drafts
  // always are — see listDraftSummaries). resolve() collapses `.`/`..` and
  // normalizes separators per the running OS.
  const root = resolve(draftRoot)
  const folder = resolve(folderPath)
  if (folder === root || folder !== join(root, basename(folder))) {
    throw new CapShareError(
      'DRAFT_NOT_FOUND',
      'Refusing to delete: target is not a CapCut project folder inside the draft root.',
      `folder=${folder} root=${root}`
    )
  }
  if (!existsSync(folder)) {
    throw new CapShareError('DRAFT_NOT_FOUND', `Project folder no longer exists: ${folder}`)
  }
  if (!findTimelinePath(folder)) {
    throw new CapShareError('DRAFT_NOT_FOUND', `Not a CapCut project (no timeline file): ${folder}`)
  }

  const { backupPath } = await removeRegistryEntry(root, { draftId, folderPath: folder })
  try {
    await trashFolder(folder)
  } catch (error) {
    await restoreRegistryBackup(root, backupPath)
    throw CapShareError.wrap(error, 'DELETE_FAILED')
  }
  await removeRegistryBackup(backupPath)
}
