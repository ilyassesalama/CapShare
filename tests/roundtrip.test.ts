import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DRAFT_PATH_PLACEHOLDER } from '../src/main/core/capcut/constants'
import { detectCapCutEnv } from '../src/main/core/capcut/locator'
import type { CapCutEnv } from '../src/main/core/capcut/model'
import { exportDraft } from '../src/main/core/capshare/export'
import { importCapshare, inspectCapshare } from '../src/main/core/capshare/import'
import { CAPSHARE_FORMAT_VERSION, type CapShareManifest } from '../src/main/core/capshare/manifest'
import { ZipWriter } from '../src/main/core/zip'
import { walkFiles } from '../src/main/core/fsx'
import {
  createMacDraft,
  createWinFlavoredDraftFolder,
  makeMacMachine,
  makeWinMachine,
  type FakeMacMachine,
  type FakeWinMachine
} from './fixtures/factory'

let tmp: string
let mac: FakeMacMachine
let win: FakeWinMachine

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'capshare-roundtrip-'))
  mac = makeMacMachine(tmp)
  win = makeWinMachine(tmp)
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function macEnv(): CapCutEnv {
  const env = detectCapCutEnv({ platform: 'darwin', homeDir: mac.homeDir })
  if (!env) throw new Error('mac fixture env missing')
  return env
}

function winEnv(): CapCutEnv {
  const env = detectCapCutEnv({
    platform: 'win32',
    homeDir: win.homeDir,
    localAppData: win.localAppData
  })
  if (!env) throw new Error('win fixture env missing')
  return env
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

const TEST_UUIDS = ['11111111-AAAA-4AAA-8AAA-111111111111', '22222222-BBBB-4BBB-8BBB-222222222222']

describe('Mac → Windows roundtrip', () => {
  it('imports a mac-exported capshare onto a fresh windows machine', async () => {
    const looseDir = join(tmp, 'mac-external')
    const draft = createMacDraft(mac, { name: 'Cross Platform', looseMediaDir: looseDir })
    const capshare = join(tmp, 'cross.capshare')

    await exportDraft({
      draftFolder: draft.folder,
      env: macEnv(),
      destinationPath: capshare,
      includeCaches: false,
      capshareVersion: 'test'
    })

    const env = winEnv()
    const result = await importCapshare({
      filePath: capshare,
      env,
      backupDir: join(tmp, 'backups')
    })

    expect(result.draftName).toBe('Cross Platform')
    const folder = result.folderPath
    expect(existsSync(folder)).toBe(true)

    // Fresh win machine → no local evidence → both timeline filenames written.
    expect(existsSync(join(folder, 'draft_content.json'))).toBe(true)
    expect(existsSync(join(folder, 'draft_info.json'))).toBe(true)

    const timeline = readJson(join(folder, 'draft_content.json'))
    const timelineText = JSON.stringify(timeline)

    // Platform identity now belongs to the target machine (synthesized).
    expect((timeline['platform'] as Record<string, unknown>)['os']).toBe('windows')
    expect((timeline['last_modified_platform'] as Record<string, unknown>)['os']).toBe('windows')
    expect((timeline['platform'] as Record<string, unknown>)['device_id']).toBe('')
    expect(result.warnings.some((w) => w.includes('synthesized'))).toBe(true)

    // Effect-cache paths rewritten to the windows cache root.
    const cacheJson = env.canonicalCacheDirJson
    for (const suffix of draft.cacheSuffixes) {
      expect(timelineText).toContain(`${cacheJson}/${suffix}`)
    }
    // No mac container spellings survive.
    expect(timelineText).not.toContain('com.lemon.lvoverseas')

    // Effect-cache files restored on the target machine.
    for (const suffix of draft.cacheSuffixes) {
      expect(existsSync(join(env.cacheDir, ...suffix.split('/')))).toBe(true)
    }

    // Placeholder media untouched; loose media relocated into the draft.
    expect(timelineText).toContain(
      `${DRAFT_PATH_PLACEHOLDER}/Resources/local/${draft.localMedia[0].fileName}`
    )
    expect(timelineText).toContain(`${DRAFT_PATH_PLACEHOLDER}/Resources/local/b-roll clip.mp4`)
    expect(existsSync(join(folder, 'Resources', 'local', 'b-roll clip.mp4'))).toBe(true)
    expect(timelineText).not.toContain(mac.homeDir.split('\\').join('/'))

    // Meta rewritten for the target machine.
    const meta = readJson(join(folder, 'draft_meta_info.json'))
    expect(meta['draft_fold_path']).toBe(folder.split('\\').join('/'))
    expect(meta['draft_root_path']).toBe(env.draftRoot.split('\\').join('/'))
    const metaText = JSON.stringify(meta)
    expect(metaText).toContain('./Resources/local/b-roll clip.mp4')

    // Volatile files never survive the trip.
    expect(existsSync(join(folder, 'draft_info.json.bak'))).toBe(false)
    expect(existsSync(join(folder, 'template-2.tmp'))).toBe(false)
    expect(existsSync(join(folder, 'template.tmp'))).toBe(false)

    // Lean export → AI caches not carried over.
    expect(existsSync(join(folder, 'matting'))).toBe(false)

    // Fresh machine has no registry → none invented.
    expect(existsSync(join(env.draftRoot, 'root_meta_info.json'))).toBe(false)

    // No leftover staging dirs.
    const leftovers: string[] = []
    for await (const f of walkFiles(env.draftRoot)) {
      if (f.relPath.includes('.capshare-staging')) leftovers.push(f.relPath)
    }
    expect(leftovers).toEqual([])
  })
})

describe('Windows-authored capshare → Mac machine', () => {
  /** Builds a .capshare by hand around a realistic Windows draft folder. */
  async function buildWinCapshare(): Promise<{
    capsharePath: string
    fixture: ReturnType<typeof createWinFlavoredDraftFolder>
  }> {
    const fixture = createWinFlavoredDraftFolder(join(tmp, 'win-source'))
    const capsharePath = join(tmp, 'from-windows.capshare')
    const writer = new ZipWriter(capsharePath)

    for await (const file of walkFiles(fixture.folder)) {
      const base = file.relPath.split('/').pop() ?? ''
      if (/\.bak$|^template/.test(base)) continue
      await writer.add({ kind: 'file', absPath: file.absPath, zipPath: `draft/${file.relPath}` })
    }
    await writer.add({
      kind: 'buffer',
      data: Buffer.from('win-loose-voiceover-bytes'),
      zipPath: 'assets/loose/1-voiceover_final.wav'
    })
    await writer.add({
      kind: 'buffer',
      data: Buffer.from('win-effect-cache-bytes'),
      zipPath: `assets/effects/${fixture.cacheSuffixes[0]}`
    })

    const manifest: CapShareManifest = {
      formatVersion: CAPSHARE_FORMAT_VERSION,
      source: {
        os: 'windows',
        capcutVersion: '8.5.0',
        newVersion: '167.0.0',
        draftId: fixture.metaDraftId,
        timelineId: fixture.timelineId,
        draftName: 'Win Project',
        timelineFilename: 'draft_content.json',
        exportedAt: '2026-06-01T00:00:00.000Z',
        capshareVersion: 'test'
      },
      project: {
        durationUs: 6000000,
        fps: 60,
        canvas: { width: 1920, height: 1080 },
        mediaCounts: { video: 1, audio: 1, image: 0 },
        tracks: []
      },
      contents: { includesCaches: false, fileCount: 5, totalBytes: 4096 },
      looseMedia: [
        {
          archivePath: 'assets/loose/1-voiceover_final.wav',
          originalPath: fixture.looseMediaJsonPath,
          fileName: 'voiceover_final.wav',
          size: 25,
          sha256: 'x'.repeat(64)
        }
      ],
      effectAssets: [
        {
          archivePath: `assets/effects/${fixture.cacheSuffixes[0]}`,
          cacheSuffix: fixture.cacheSuffixes[0],
          size: 22
        }
      ],
      integrity: {},
      missingAtExport: [],
      warnings: []
    }
    await writer.add({
      kind: 'buffer',
      data: Buffer.from(JSON.stringify(manifest)),
      zipPath: 'manifest.json'
    })
    await writer.finish()
    return { capsharePath, fixture }
  }

  it('rewrites windows paths to mac conventions and uses the local timeline filename', async () => {
    // The mac machine already has a draft → donor platform + filename evidence + registry.
    createMacDraft(mac, { name: 'Existing Local' })
    const { capsharePath, fixture } = await buildWinCapshare()
    const env = macEnv()

    const preview = await inspectCapshare(capsharePath, env)
    expect(preview.compat.sourceOs).toBe('windows')
    expect(preview.compat.warnings.some((w) => w.includes('exported on Windows'))).toBe(true)
    expect(preview.collision).toBeNull()

    const result = await importCapshare({
      filePath: capsharePath,
      env,
      backupDir: join(tmp, 'backups')
    })

    const folder = result.folderPath
    // Local drafts use draft_info.json → no dual write, stale name removed.
    expect(existsSync(join(folder, 'draft_info.json'))).toBe(true)
    expect(existsSync(join(folder, 'draft_content.json'))).toBe(false)

    const timeline = readJson(join(folder, 'draft_info.json'))
    const timelineText = JSON.stringify(timeline)

    // Donor platform harvested from the existing local draft.
    const platform = timeline['platform'] as Record<string, unknown>
    expect(platform['os']).toBe('mac')
    expect(platform['device_id']).toBe('c4ca4238a0b923820dcc509a6f75849b')

    // C:/ cache path → mac container cache spelling.
    expect(timelineText).toContain(`${env.canonicalCacheDirJson}/${fixture.cacheSuffixes[0]}`)
    expect(timelineText).not.toContain('C:/Users/Tester')

    // D:/ loose media relocated and placeholder-rewritten.
    expect(timelineText).toContain(`${DRAFT_PATH_PLACEHOLDER}/Resources/local/voiceover_final.wav`)
    expect(existsSync(join(folder, 'Resources', 'local', 'voiceover_final.wav'))).toBe(true)
    expect(timelineText).not.toContain('D:/Footage')

    // Cache file restored under the mac cache dir.
    expect(existsSync(join(env.cacheDir, ...fixture.cacheSuffixes[0].split('/')))).toBe(true)

    // Registry upserted: existing entry + the imported one, count bumped.
    const registry = readJson(join(env.draftRoot, 'root_meta_info.json')) as {
      all_draft_store: Record<string, unknown>[]
      draft_ids: number
    }
    expect(registry.all_draft_store).toHaveLength(2)
    expect(registry.draft_ids).toBe(2)
    const entry = registry.all_draft_store.find((e) => e['draft_id'] === fixture.metaDraftId)!
    expect(entry).toBeDefined()
    expect(entry['draft_json_file']).toBe(`${folder.split('\\').join('/')}/draft_info.json`)
    expect(entry['draft_fold_path']).toBe(folder.split('\\').join('/'))
    // No stray registry backups left behind.
    expect(existsSync(join(env.draftRoot, 'root_meta_info.json'))).toBe(true)
  })
})

describe('collision handling', () => {
  async function exportFixture(name: string): Promise<string> {
    const draft = createMacDraft(mac, { name })
    const capshare = join(tmp, `${name}.capshare`)
    await exportDraft({
      draftFolder: draft.folder,
      env: macEnv(),
      destinationPath: capshare,
      includeCaches: false,
      capshareVersion: 'test'
    })
    return capshare
  }

  it('throws COLLISION_UNRESOLVED when the project exists and no resolution given', async () => {
    const capshare = await exportFixture('Collide')
    await expect(
      importCapshare({ filePath: capshare, env: macEnv(), backupDir: join(tmp, 'backups') })
    ).rejects.toMatchObject({ code: 'COLLISION_UNRESOLVED' })
  })

  it('imports as copy with fresh independent ids', async () => {
    const capshare = await exportFixture('Copy Me')
    const env = macEnv()
    let uuidCalls = 0

    const result = await importCapshare({
      filePath: capshare,
      env,
      resolution: 'copy',
      backupDir: join(tmp, 'backups'),
      uuid: () => TEST_UUIDS[uuidCalls++]
    })

    expect(result.draftName).toBe('Copy Me 2')
    expect(existsSync(result.folderPath)).toBe(true)
    expect(existsSync(join(env.draftRoot, 'Copy Me'))).toBe(true) // original intact

    const meta = readJson(join(result.folderPath, 'draft_meta_info.json'))
    const timeline = readJson(join(result.folderPath, 'draft_info.json'))
    // The two UUID namespaces are regenerated INDEPENDENTLY.
    expect(meta['draft_id']).toBe(TEST_UUIDS[0])
    expect(timeline['id']).toBe(TEST_UUIDS[1])
    expect(meta['draft_id']).not.toBe(timeline['id'])
    expect(meta['draft_name']).toBe('Copy Me 2')

    const registry = readJson(join(env.draftRoot, 'root_meta_info.json')) as {
      all_draft_store: Record<string, unknown>[]
      draft_ids: number
    }
    expect(registry.all_draft_store).toHaveLength(2)
    expect(registry.draft_ids).toBe(2)
  })

  it('replaces the existing project with a backup outside the draft root', async () => {
    const capshare = await exportFixture('Replace Me')
    const env = macEnv()
    const backupDir = join(tmp, 'backups')

    const result = await importCapshare({
      filePath: capshare,
      env,
      resolution: 'replace',
      backupDir
    })

    expect(result.draftName).toBe('Replace Me')
    expect(existsSync(result.folderPath)).toBe(true)
    expect(result.warnings.some((w) => w.includes('backed up'))).toBe(true)

    // Backup landed outside the draft root (it must not show up in CapCut).
    const backups: string[] = []
    for await (const f of walkFiles(backupDir)) backups.push(f.relPath)
    expect(backups.length).toBeGreaterThan(0)

    // Registry still lists exactly one entry for this draft (patched, not duplicated).
    const registry = readJson(join(env.draftRoot, 'root_meta_info.json')) as {
      all_draft_store: Record<string, unknown>[]
      draft_ids: number
    }
    const entries = registry.all_draft_store.filter((e) => e['draft_name'] === 'Replace Me')
    expect(entries).toHaveLength(1)
    expect(registry.draft_ids).toBe(1)
  })
})

describe('inspectCapshare', () => {
  it('rejects non-capshare files with ARCHIVE_INVALID', async () => {
    const bogus = join(tmp, 'bogus.capshare')
    const writer = new ZipWriter(bogus)
    await writer.add({ kind: 'buffer', data: Buffer.from('hello'), zipPath: 'readme.txt' })
    await writer.finish()
    await expect(inspectCapshare(bogus, null)).rejects.toMatchObject({ code: 'ARCHIVE_INVALID' })
  })

  it('returns a full preview from a real export', async () => {
    const draft = createMacDraft(mac, { name: 'Preview Me' })
    const capshare = join(tmp, 'preview.capshare')
    await exportDraft({
      draftFolder: draft.folder,
      env: macEnv(),
      destinationPath: capshare,
      includeCaches: false,
      capshareVersion: 'test'
    })

    const preview = await inspectCapshare(capshare, winEnv())
    expect(preview.draftName).toBe('Preview Me')
    expect(preview.durationUs).toBe(12000000)
    expect(preview.coverDataUrl).toMatch(/^data:image\/jpeg/)
    expect(preview.compat.sourceOs).toBe('mac')
    expect(preview.compat.sourceCapcutVersion).toBe('8.7.0')
    expect(preview.collision).toBeNull()
    expect(preview.compat.warnings.some((w) => w.includes('exported on macOS'))).toBe(true)
  })
})
