import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { updateDraft } from '../src/main/core/capcut/update'
import { createMacDraft, makeMacMachine, type FakeMacMachine } from './fixtures/factory'

let tmp: string
let mac: FakeMacMachine

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'capshare-update-'))
  mac = makeMacMachine(tmp)
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

const NEW_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x99, 0x99, 0xff, 0xd9])

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

function registryEntries(draftRoot: string): Record<string, unknown>[] {
  return (
    readJson(join(draftRoot, 'root_meta_info.json')) as {
      all_draft_store: Record<string, unknown>[]
    }
  ).all_draft_store
}

function noBackupLeftovers(draftRoot: string): boolean {
  return readdirSync(draftRoot).every((n) => !n.includes('capshare-backup'))
}

describe('updateDraft', () => {
  it('replaces the cover without touching name, folder, or registry', async () => {
    const draft = createMacDraft(mac, { name: 'Covered' })
    const registryBefore = readFileSync(join(mac.draftRoot, 'root_meta_info.json'), 'utf8')

    const result = await updateDraft({
      draftRoot: mac.draftRoot,
      folderPath: draft.folder,
      draftId: draft.metaDraftId,
      coverJpeg: NEW_JPEG,
      os: 'mac'
    })

    expect(result).toEqual({ folderPath: draft.folder, name: 'Covered' })
    expect(readFileSync(join(draft.folder, 'draft_cover.jpg'))).toEqual(NEW_JPEG)
    expect(readFileSync(join(mac.draftRoot, 'root_meta_info.json'), 'utf8')).toBe(registryBefore)
  })

  it('writes a cover into a draft that never had one', async () => {
    const draft = createMacDraft(mac, { name: 'Coverless' })
    rmSync(join(draft.folder, 'draft_cover.jpg'))

    await updateDraft({
      draftRoot: mac.draftRoot,
      folderPath: draft.folder,
      draftId: draft.metaDraftId,
      coverJpeg: NEW_JPEG,
      os: 'mac'
    })

    expect(readFileSync(join(draft.folder, 'draft_cover.jpg'))).toEqual(NEW_JPEG)
  })

  it('renames folder, meta, and registry entry — leaving timestamps untouched', async () => {
    const draft = createMacDraft(mac, { name: 'Old Name' })

    const result = await updateDraft({
      draftRoot: mac.draftRoot,
      folderPath: draft.folder,
      draftId: draft.metaDraftId,
      newName: 'New Name',
      os: 'mac'
    })

    const newFolder = join(mac.draftRoot, 'New Name')
    expect(result).toEqual({ folderPath: newFolder, name: 'New Name' })
    expect(existsSync(draft.folder)).toBe(false)
    expect(existsSync(join(newFolder, 'draft_info.json'))).toBe(true)

    const meta = readJson(join(newFolder, 'draft_meta_info.json'))
    expect(meta['draft_name']).toBe('New Name')
    expect(meta['draft_fold_path']).toBe(newFolder.split('\\').join('/'))
    expect(meta['draft_id']).toBe(draft.metaDraftId)

    const [entry] = registryEntries(mac.draftRoot)
    const newFolderJson = newFolder.split('\\').join('/')
    expect(entry['draft_name']).toBe('New Name')
    expect(entry['draft_fold_path']).toBe(newFolderJson)
    expect(entry['draft_json_file']).toBe(`${newFolderJson}/draft_info.json`)
    expect(entry['draft_cover']).toBe(`${newFolderJson}/draft_cover.jpg`)
    expect(entry['tm_draft_create']).toBe(1780756859388099)
    expect(entry['tm_draft_modified']).toBe(1780765223363020)
    expect(noBackupLeftovers(mac.draftRoot)).toBe(true)
  })

  it('suffixes the folder name when it collides with an existing draft', async () => {
    const draft = createMacDraft(mac, { name: 'Mine' })
    const taken = join(mac.draftRoot, 'Taken')
    mkdirSync(taken)
    writeFileSync(join(taken, 'draft_info.json'), '{}')

    const result = await updateDraft({
      draftRoot: mac.draftRoot,
      folderPath: draft.folder,
      draftId: draft.metaDraftId,
      newName: 'Taken',
      os: 'mac'
    })

    expect(result).toEqual({ folderPath: join(mac.draftRoot, 'Taken 2'), name: 'Taken' })
    expect(readJson(join(result.folderPath, 'draft_meta_info.json'))['draft_name']).toBe('Taken')
  })

  it('updates only the display name when the sanitized name matches the folder', async () => {
    const draft = createMacDraft(mac, { name: 'Same Folder' })

    // 'Same / Folder' sanitizes to 'Same Folder' — folder must stay in place.
    const result = await updateDraft({
      draftRoot: mac.draftRoot,
      folderPath: draft.folder,
      draftId: draft.metaDraftId,
      newName: 'Same / Folder',
      os: 'mac'
    })

    expect(result).toEqual({ folderPath: draft.folder, name: 'Same / Folder' })
    expect(readJson(join(draft.folder, 'draft_meta_info.json'))['draft_name']).toBe('Same / Folder')
    expect(registryEntries(mac.draftRoot)[0]['draft_name']).toBe('Same / Folder')
  })

  it('renames the folder even when the registry is missing', async () => {
    const draft = createMacDraft(mac, { name: 'No Registry' })
    rmSync(join(mac.draftRoot, 'root_meta_info.json'))

    const result = await updateDraft({
      draftRoot: mac.draftRoot,
      folderPath: draft.folder,
      draftId: draft.metaDraftId,
      newName: 'Still Works',
      os: 'mac'
    })

    expect(result.folderPath).toBe(join(mac.draftRoot, 'Still Works'))
    expect(existsSync(join(result.folderPath, 'draft_info.json'))).toBe(true)
  })

  it('refuses a target outside the draft root', async () => {
    await expect(
      updateDraft({
        draftRoot: mac.draftRoot,
        folderPath: mac.homeDir,
        draftId: 'x',
        newName: 'Nope',
        os: 'mac'
      })
    ).rejects.toMatchObject({ code: 'DRAFT_NOT_FOUND' })
    expect(existsSync(mac.homeDir)).toBe(true)
  })

  it('refuses the draft root itself', async () => {
    await expect(
      updateDraft({
        draftRoot: mac.draftRoot,
        folderPath: mac.draftRoot,
        draftId: 'x',
        coverJpeg: NEW_JPEG,
        os: 'mac'
      })
    ).rejects.toMatchObject({ code: 'DRAFT_NOT_FOUND' })
  })

  it('refuses a folder that is not a CapCut draft (no timeline)', async () => {
    const notADraft = join(mac.draftRoot, 'Just A Folder')
    mkdirSync(notADraft, { recursive: true })
    await expect(
      updateDraft({
        draftRoot: mac.draftRoot,
        folderPath: notADraft,
        draftId: 'x',
        newName: 'Nope',
        os: 'mac'
      })
    ).rejects.toMatchObject({ code: 'DRAFT_NOT_FOUND' })
    expect(existsSync(notADraft)).toBe(true)
  })
})
