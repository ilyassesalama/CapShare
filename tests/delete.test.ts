import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteDraft } from '../src/main/core/capcut/delete'
import { createMacDraft, makeMacMachine, type FakeMacMachine } from './fixtures/factory'

let tmp: string
let mac: FakeMacMachine

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'capshare-delete-'))
  mac = makeMacMachine(tmp)
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

/** A trash that actually removes the folder, recording that it ran. */
function recordingTrash(): { fn: (p: string) => Promise<void>; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    fn: async (p: string) => {
      calls.push(p)
      rmSync(p, { recursive: true, force: true })
    }
  }
}

function noBackupLeftovers(draftRoot: string): boolean {
  return readdirSync(draftRoot).every((n) => !n.includes('capshare-backup'))
}

describe('deleteDraft', () => {
  it('trashes the folder, scrubs the registry, and leaves no backup behind', async () => {
    const draft = createMacDraft(mac, { name: 'Goodbye' })
    const trash = recordingTrash()

    await deleteDraft({
      draftRoot: mac.draftRoot,
      folderPath: draft.folder,
      draftId: draft.metaDraftId,
      trashFolder: trash.fn
    })

    expect(trash.calls).toHaveLength(1)
    expect(existsSync(draft.folder)).toBe(false)

    const registry = JSON.parse(
      readFileSync(join(mac.draftRoot, 'root_meta_info.json'), 'utf8')
    ) as { all_draft_store: unknown[]; draft_ids: number }
    expect(registry.all_draft_store).toHaveLength(0)
    expect(registry.draft_ids).toBe(0)
    // On success the registry backup is removed.
    expect(noBackupLeftovers(mac.draftRoot)).toBe(true)
  })

  it('restores the registry and keeps the folder when trashing fails', async () => {
    const draft = createMacDraft(mac, { name: 'Survivor' })
    const before = readFileSync(join(mac.draftRoot, 'root_meta_info.json'), 'utf8')

    await expect(
      deleteDraft({
        draftRoot: mac.draftRoot,
        folderPath: draft.folder,
        draftId: draft.metaDraftId,
        trashFolder: async () => {
          throw new Error('trash is full')
        }
      })
    ).rejects.toMatchObject({ code: 'DELETE_FAILED' })

    // Folder untouched, registry restored to its exact prior content, no leftovers.
    expect(existsSync(join(draft.folder, 'draft_info.json'))).toBe(true)
    expect(readFileSync(join(mac.draftRoot, 'root_meta_info.json'), 'utf8')).toBe(before)
    expect(noBackupLeftovers(mac.draftRoot)).toBe(true)
  })

  it('refuses a target outside the draft root without trashing anything', async () => {
    const trash = recordingTrash()
    await expect(
      deleteDraft({
        draftRoot: mac.draftRoot,
        folderPath: mac.homeDir, // well outside the draft root
        draftId: 'x',
        trashFolder: trash.fn
      })
    ).rejects.toMatchObject({ code: 'DRAFT_NOT_FOUND' })
    expect(trash.calls).toHaveLength(0)
    expect(existsSync(mac.homeDir)).toBe(true)
  })

  it('refuses the draft root itself', async () => {
    const trash = recordingTrash()
    await expect(
      deleteDraft({
        draftRoot: mac.draftRoot,
        folderPath: mac.draftRoot,
        draftId: 'x',
        trashFolder: trash.fn
      })
    ).rejects.toMatchObject({ code: 'DRAFT_NOT_FOUND' })
    expect(trash.calls).toHaveLength(0)
  })

  it('refuses a folder that is not a CapCut draft (no timeline)', async () => {
    const notADraft = join(mac.draftRoot, 'Just A Folder')
    mkdirSync(notADraft, { recursive: true })
    const trash = recordingTrash()
    await expect(
      deleteDraft({
        draftRoot: mac.draftRoot,
        folderPath: notADraft,
        draftId: 'x',
        trashFolder: trash.fn
      })
    ).rejects.toMatchObject({ code: 'DRAFT_NOT_FOUND' })
    expect(trash.calls).toHaveLength(0)
    expect(existsSync(notADraft)).toBe(true)
  })
})
