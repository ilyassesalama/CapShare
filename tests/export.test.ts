import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectCapCutEnv } from '../src/main/core/capcut/locator'
import { exportDraft } from '../src/main/core/capshare/export'
import { parseManifest } from '../src/main/core/capshare/manifest'
import { readZipEntries } from '../src/main/core/zip'
import { createMacDraft, makeMacMachine, type FakeMacMachine } from './fixtures/factory'

let tmp: string
let machine: FakeMacMachine

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'capshare-export-'))
  machine = makeMacMachine(tmp)
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function envFor(machine: FakeMacMachine): NonNullable<ReturnType<typeof detectCapCutEnv>> {
  const env = detectCapCutEnv({ platform: 'darwin', homeDir: machine.homeDir })
  if (!env) throw new Error('fixture machine not detected')
  return env
}

async function listEntryNames(zipPath: string): Promise<string[]> {
  // readZipEntries with an impossible name walks the whole central directory;
  // simpler: read manifest and use integrity keys + known names. For tests we
  // read the manifest and cover and assert on those.
  const entries = await readZipEntries(zipPath, ['manifest.json'])
  const manifest = parseManifest(entries.get('manifest.json')!.toString('utf8'))
  return Object.keys(manifest.integrity)
}

describe('exportDraft', () => {
  it('produces a lean archive with manifest, cover, draft files and effect assets', async () => {
    const draft = createMacDraft(machine, { name: 'Lean Export' })
    const dest = join(tmp, 'lean.capshare')

    const progress: number[] = []
    const result = await exportDraft({
      draftFolder: draft.folder,
      env: envFor(machine),
      destinationPath: dest,
      includeCaches: false,
      capshareVersion: '0.1.0-test',
      now: () => new Date('2026-06-07T12:00:00Z'),
      onProgress: (p, t) => progress.push(t > 0 ? p / t : 0)
    })

    expect(result.capsharePath).toBe(dest)
    expect(result.sizeBytes).toBeGreaterThan(0)
    expect(progress.length).toBeGreaterThan(0)
    expect(progress[progress.length - 1]).toBeLessThanOrEqual(1)

    const entries = await readZipEntries(dest, ['manifest.json', 'cover.jpg'])
    expect(entries.has('cover.jpg')).toBe(true)

    const manifest = parseManifest(entries.get('manifest.json')!.toString('utf8'))
    expect(manifest.formatVersion).toBe(1)
    expect(manifest.source).toMatchObject({
      os: 'mac',
      capcutVersion: '8.7.0',
      newVersion: '171.0.0',
      draftId: draft.metaDraftId,
      timelineId: draft.timelineId,
      draftName: 'Lean Export',
      timelineFilename: 'draft_info.json',
      exportedAt: '2026-06-07T12:00:00.000Z',
      capshareVersion: '0.1.0-test'
    })
    expect(manifest.project.durationUs).toBe(12000000)
    expect(manifest.project.tracks.map((t) => t.type)).toEqual(['video', 'audio', 'text'])
    expect(manifest.contents.includesCaches).toBe(false)

    // Both effect-cache assets bundled with machine-independent suffixes.
    expect(manifest.effectAssets.map((e) => e.cacheSuffix).sort()).toEqual(
      [...draft.cacheSuffixes].sort()
    )

    const draftEntries = Object.keys(manifest.integrity)
    expect(draftEntries).toContain('draft_info.json')
    expect(draftEntries).toContain('draft_meta_info.json')
    expect(draftEntries).toContain('Resources/local/1ea7778f132da493c57bc82ba2a21317.mp4')
    // Lean export drops AI caches, volatile files, junk:
    expect(draftEntries.some((e) => e.startsWith('matting/'))).toBe(false)
    expect(draftEntries.some((e) => e.endsWith('.bak'))).toBe(false)
    expect(draftEntries.some((e) => e.includes('template'))).toBe(false)
    expect(draftEntries.some((e) => e.includes('.DS_Store'))).toBe(false)

    expect(manifest.looseMedia).toEqual([])
    expect(manifest.missingAtExport).toEqual([])
  })

  it('includes regenerable caches when includeCaches is true', async () => {
    const draft = createMacDraft(machine, { name: 'Full Export' })
    const dest = join(tmp, 'full.capshare')
    await exportDraft({
      draftFolder: draft.folder,
      env: envFor(machine),
      destinationPath: dest,
      includeCaches: true,
      capshareVersion: '0.1.0-test'
    })
    const entryNames = await listEntryNames(dest)
    expect(entryNames.some((e) => e.startsWith('matting/'))).toBe(true)
  })

  it('bundles loose media that lives outside the draft folder', async () => {
    const looseDir = join(tmp, 'external-footage')
    const draft = createMacDraft(machine, { name: 'Loose Export', looseMediaDir: looseDir })
    const dest = join(tmp, 'loose.capshare')

    const result = await exportDraft({
      draftFolder: draft.folder,
      env: envFor(machine),
      destinationPath: dest,
      includeCaches: false,
      capshareVersion: '0.1.0-test'
    })

    const entries = await readZipEntries(dest, ['manifest.json'])
    const manifest = parseManifest(entries.get('manifest.json')!.toString('utf8'))
    expect(manifest.looseMedia).toHaveLength(1)
    expect(manifest.looseMedia[0]).toMatchObject({
      fileName: 'b-roll clip.mp4',
      originalPath: draft.looseMediaPaths[0].split('\\').join('/')
    })
    expect(manifest.looseMedia[0].archivePath.startsWith('assets/loose/')).toBe(true)

    const media = await readZipEntries(dest, [manifest.looseMedia[0].archivePath])
    expect(media.get(manifest.looseMedia[0].archivePath)!.toString()).toBe('loose-broll-bytes')
    expect(result.warnings).toEqual([])
  })

  it('records missing loose media instead of failing', async () => {
    const looseDir = join(tmp, 'external-footage')
    const draft = createMacDraft(machine, { name: 'Missing Media', looseMediaDir: looseDir })
    rmSync(draft.looseMediaPaths[0])

    const dest = join(tmp, 'missing.capshare')
    const result = await exportDraft({
      draftFolder: draft.folder,
      env: envFor(machine),
      destinationPath: dest,
      includeCaches: false,
      capshareVersion: '0.1.0-test'
    })

    const entries = await readZipEntries(dest, ['manifest.json'])
    const manifest = parseManifest(entries.get('manifest.json')!.toString('utf8'))
    expect(manifest.looseMedia).toEqual([])
    expect(manifest.missingAtExport).toHaveLength(1)
    expect(result.warnings.some((w) => w.includes('missing at export'))).toBe(true)
  })

  it('never bundles provenance src_path duplicates from copied_info', async () => {
    const draft = createMacDraft(machine, { name: 'Provenance' })
    const dest = join(tmp, 'prov.capshare')
    await exportDraft({
      draftFolder: draft.folder,
      env: envFor(machine),
      destinationPath: dest,
      includeCaches: false,
      capshareVersion: '0.1.0-test'
    })
    const entries = await readZipEntries(dest, ['manifest.json'])
    const manifest = parseManifest(entries.get('manifest.json')!.toString('utf8'))
    // The fixture's copied_info src_path (~Downloads/clip-one.mp4) must appear
    // neither as loose media nor as missing.
    expect(manifest.looseMedia).toEqual([])
    expect(manifest.missingAtExport).toEqual([])
  })

  it('verifies integrity hashes match the packed bytes', async () => {
    const draft = createMacDraft(machine, { name: 'Integrity' })
    const dest = join(tmp, 'integrity.capshare')
    await exportDraft({
      draftFolder: draft.folder,
      env: envFor(machine),
      destinationPath: dest,
      includeCaches: false,
      capshareVersion: '0.1.0-test'
    })
    const entries = await readZipEntries(dest, ['manifest.json'])
    const manifest = parseManifest(entries.get('manifest.json')!.toString('utf8'))

    const mediaRel = `Resources/local/${draft.localMedia[0].fileName}`
    const packed = await readZipEntries(dest, [`draft/${mediaRel}`])
    const bytes = packed.get(`draft/${mediaRel}`)!
    const { createHash } = await import('node:crypto')
    expect(manifest.integrity[mediaRel].sha256).toBe(
      createHash('sha256').update(bytes).digest('hex')
    )
    expect(manifest.integrity[mediaRel].size).toBe(bytes.length)
  })
})
