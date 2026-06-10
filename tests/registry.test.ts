import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeRegistryEntry, upsertRegistryEntry } from '../src/main/core/capcut/registry'
import { detectCapCutEnv } from '../src/main/core/capcut/locator'
import { exportDraft } from '../src/main/core/capshare/export'
import { importCapshare } from '../src/main/core/capshare/import'
import { ZipWriter } from '../src/main/core/zip'
import { CAPSHARE_FORMAT_VERSION } from '../src/main/core/capshare/manifest'
import { createMacDraft, makeMacMachine, type FakeMacMachine } from './fixtures/factory'

let tmp: string
let mac: FakeMacMachine

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'capshare-registry-'))
  mac = makeMacMachine(tmp)
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

const PARAMS = {
  draftId: '99999999-9999-4999-8999-999999999999',
  draftName: 'Registered',
  draftRoot: '',
  folderPath: '',
  timelineFilename: 'draft_info.json' as const,
  createUs: 1780000000000000,
  modifiedUs: 1780000000000001,
  durationUs: 5000000,
  materialsSizeBytes: 42
}

describe('upsertRegistryEntry', () => {
  it('skips when the registry file is missing (CapCut rebuilds by scan)', async () => {
    const result = await upsertRegistryEntry(mac.draftRoot, {
      ...PARAMS,
      draftRoot: mac.draftRoot,
      folderPath: join(mac.draftRoot, 'Registered')
    })
    expect(result.action).toBe('skipped-missing')
    expect(existsSync(join(mac.draftRoot, 'root_meta_info.json'))).toBe(false)
  })

  it('skips malformed registries without touching them', async () => {
    const registryPath = join(mac.draftRoot, 'root_meta_info.json')
    writeFileSync(registryPath, '{"all_draft_store": "not-an-array"}')
    const result = await upsertRegistryEntry(mac.draftRoot, {
      ...PARAMS,
      draftRoot: mac.draftRoot,
      folderPath: join(mac.draftRoot, 'Registered')
    })
    expect(result.action).toBe('skipped-malformed')
    expect(readFileSync(registryPath, 'utf8')).toBe('{"all_draft_store": "not-an-array"}')
  })

  it('clones the first entry as a template when inserting', async () => {
    createMacDraft(mac, { name: 'Template Source' })
    const result = await upsertRegistryEntry(mac.draftRoot, {
      ...PARAMS,
      draftRoot: mac.draftRoot,
      folderPath: join(mac.draftRoot, 'Registered')
    })
    expect(result.action).toBe('inserted')

    const registry = JSON.parse(
      readFileSync(join(mac.draftRoot, 'root_meta_info.json'), 'utf8')
    ) as { all_draft_store: Record<string, unknown>[]; draft_ids: number }
    expect(registry.all_draft_store).toHaveLength(2)
    expect(registry.draft_ids).toBe(2)

    const entry = registry.all_draft_store[0]
    expect(entry['draft_id']).toBe(PARAMS.draftId)
    // Cloned template fields survive (proving we didn't build a bare object).
    expect(entry['draft_timeline_materials_size']).toBe(42)
    expect(entry['tm_draft_removed']).toBe(0)
  })

  it('patches an existing entry by draft_id without bumping the count', async () => {
    const draft = createMacDraft(mac, { name: 'Patch Me' })
    const result = await upsertRegistryEntry(mac.draftRoot, {
      ...PARAMS,
      draftId: draft.metaDraftId,
      draftName: 'Patch Me Renamed',
      draftRoot: mac.draftRoot,
      folderPath: draft.folder
    })
    expect(result.action).toBe('patched')

    const registry = JSON.parse(
      readFileSync(join(mac.draftRoot, 'root_meta_info.json'), 'utf8')
    ) as { all_draft_store: Record<string, unknown>[]; draft_ids: number }
    expect(registry.all_draft_store).toHaveLength(1)
    expect(registry.draft_ids).toBe(1)
    expect(registry.all_draft_store[0]['draft_name']).toBe('Patch Me Renamed')
  })
})

describe('removeRegistryEntry', () => {
  it('removes the matching entry, decrements draft_ids, and leaves a backup', async () => {
    const draft = createMacDraft(mac, { name: 'Trash Me' })
    const result = await removeRegistryEntry(mac.draftRoot, {
      draftId: draft.metaDraftId,
      folderPath: draft.folder
    })
    expect(result.action).toBe('removed')
    expect(result.backupPath).toBeTruthy()
    expect(existsSync(result.backupPath!)).toBe(true)

    const registry = JSON.parse(
      readFileSync(join(mac.draftRoot, 'root_meta_info.json'), 'utf8')
    ) as { all_draft_store: Record<string, unknown>[]; draft_ids: number }
    expect(registry.all_draft_store).toHaveLength(0)
    expect(registry.draft_ids).toBe(0)
  })

  it('matches by folder path even when the draft id differs', async () => {
    const draft = createMacDraft(mac, { name: 'By Path' })
    const result = await removeRegistryEntry(mac.draftRoot, {
      draftId: 'a-totally-different-id',
      folderPath: draft.folder
    })
    expect(result.action).toBe('removed')
    const registry = JSON.parse(
      readFileSync(join(mac.draftRoot, 'root_meta_info.json'), 'utf8')
    ) as { all_draft_store: Record<string, unknown>[] }
    expect(registry.all_draft_store).toHaveLength(0)
  })

  it('returns not-found (no backup) and leaves the registry intact when nothing matches', async () => {
    createMacDraft(mac, { name: 'Keep Me' })
    const before = readFileSync(join(mac.draftRoot, 'root_meta_info.json'), 'utf8')
    const result = await removeRegistryEntry(mac.draftRoot, {
      draftId: 'nope',
      folderPath: join(mac.draftRoot, 'Ghost')
    })
    expect(result.action).toBe('not-found')
    expect(result.backupPath).toBeNull()
    expect(readFileSync(join(mac.draftRoot, 'root_meta_info.json'), 'utf8')).toBe(before)
  })

  it('skips when the registry file is missing', async () => {
    const result = await removeRegistryEntry(mac.draftRoot, {
      draftId: 'x',
      folderPath: join(mac.draftRoot, 'x')
    })
    expect(result.action).toBe('skipped-missing')
    expect(result.backupPath).toBeNull()
  })

  it('skips malformed registries without touching them', async () => {
    const registryPath = join(mac.draftRoot, 'root_meta_info.json')
    writeFileSync(registryPath, '{"all_draft_store": 5}')
    const result = await removeRegistryEntry(mac.draftRoot, {
      draftId: 'x',
      folderPath: join(mac.draftRoot, 'x')
    })
    expect(result.action).toBe('skipped-malformed')
    expect(readFileSync(registryPath, 'utf8')).toBe('{"all_draft_store": 5}')
  })
})

describe('import rollback', () => {
  it('cleans up staging and leaves the draft root untouched when the archive is invalid', async () => {
    const writer = new ZipWriter(join(tmp, 'broken.capshare'))
    // Valid manifest, but the archive contains no draft/ entries at all.
    await writer.add({
      kind: 'buffer',
      data: Buffer.from(
        JSON.stringify({
          formatVersion: CAPSHARE_FORMAT_VERSION,
          source: {
            os: 'mac',
            capcutVersion: null,
            newVersion: null,
            draftId: 'X',
            timelineId: null,
            draftName: 'Broken',
            timelineFilename: 'draft_info.json',
            exportedAt: 'now',
            capshareVersion: 'test'
          },
          project: {
            durationUs: 0,
            fps: null,
            canvas: null,
            mediaCounts: { video: 0, audio: 0, image: 0 },
            tracks: []
          },
          contents: { includesCaches: false, fileCount: 0, totalBytes: 0 },
          looseMedia: [],
          effectAssets: [],
          integrity: {},
          missingAtExport: [],
          warnings: []
        })
      ),
      zipPath: 'manifest.json'
    })
    await writer.finish()

    const env = detectCapCutEnv({ platform: 'darwin', homeDir: mac.homeDir })!
    await expect(
      importCapshare({
        filePath: join(tmp, 'broken.capshare'),
        env,
        backupDir: join(tmp, 'backups')
      })
    ).rejects.toMatchObject({ code: 'ARCHIVE_INVALID' })

    // Nothing left behind in the draft root.
    expect(readdirSync(mac.draftRoot)).toEqual([])
  })

  it('restores the replaced draft when the import fails mid-flight', async () => {
    const draft = createMacDraft(mac, { name: 'Survivor' })
    const env = detectCapCutEnv({ platform: 'darwin', homeDir: mac.homeDir })!
    const capshare = join(tmp, 'survivor.capshare')
    await exportDraft({
      draftFolder: draft.folder,
      env,
      destinationPath: capshare,
      includeCaches: false,
      capshareVersion: 'test'
    })

    // Force failure mid-import via an aborted signal (typed CANCELLED surfaces,
    // not a blanket IMPORT_FAILED — the UI distinguishes the two).
    const controller = new AbortController()
    controller.abort()
    await expect(
      importCapshare({
        filePath: capshare,
        env,
        resolution: 'replace',
        backupDir: join(tmp, 'backups'),
        signal: controller.signal
      })
    ).rejects.toMatchObject({ code: 'CANCELLED' })

    // The original draft is still in place and readable.
    expect(existsSync(join(draft.folder, 'draft_info.json'))).toBe(true)
    const leftovers = readdirSync(mac.draftRoot).filter((n) => n.includes('staging'))
    expect(leftovers).toEqual([])
  })
})
