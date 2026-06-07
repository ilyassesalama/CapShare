/**
 * Real-machine end-to-end test — OPT-IN ONLY (CAPSHARE_REAL_E2E=1).
 *
 * Exports a real CapCut draft from this machine's library and imports it back
 * as a COPY (non-destructive: new folder + registry insert with backup).
 * After it passes, open CapCut: the "<name> 2" project should appear and play.
 */
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DRAFT_PATH_PLACEHOLDER } from '../src/main/core/capcut/constants'
import { listDraftSummaries } from '../src/main/core/capcut/draft'
import { detectCapCutEnvFromProcess } from '../src/main/core/capcut/locator'
import { exportDraft } from '../src/main/core/capshare/export'
import { importCapshare, inspectCapshare } from '../src/main/core/capshare/import'

const enabled = process.env['CAPSHARE_REAL_E2E'] === '1'

describe.runIf(enabled)('real draft roundtrip on this machine', () => {
  it('exports the most recent real draft and imports it as a copy', async () => {
    const env = detectCapCutEnvFromProcess()
    expect(env, 'CapCut must be installed for the real E2E').not.toBeNull()

    const { drafts } = await listDraftSummaries(env!.draftRoot)
    expect(drafts.length).toBeGreaterThan(0)
    const source = drafts[0]
    console.log(`[e2e] exporting "${source.name}" (${source.sizeBytes} bytes)`)

    const capsharePath = join(tmpdir(), `capshare-e2e-${Date.now()}.capshare`)
    const exported = await exportDraft({
      draftFolder: source.folderPath,
      env: env!,
      destinationPath: capsharePath,
      includeCaches: false,
      capshareVersion: 'e2e'
    })
    console.log(
      `[e2e] exported ${exported.sizeBytes} bytes, ${exported.fileCount} files, warnings: ${exported.warnings.length}`
    )
    expect(exported.sizeBytes).toBeGreaterThan(0)

    const preview = await inspectCapshare(capsharePath, env!)
    expect(preview.draftName).toBe(source.name)
    expect(preview.collision, 'same machine → collision expected').not.toBeNull()

    const result = await importCapshare({
      filePath: capsharePath,
      env: env!,
      resolution: 'copy',
      backupDir: join(tmpdir(), 'capshare-e2e-backups')
    })
    console.log(`[e2e] imported as "${result.draftName}" → ${result.folderPath}`)
    console.log(`[e2e] warnings: ${JSON.stringify(result.warnings, null, 2)}`)

    // The copy exists with a rewritten, machine-local timeline.
    expect(existsSync(result.folderPath)).toBe(true)
    const timelineRaw = readFileSync(join(result.folderPath, 'draft_info.json'), 'utf8')
    const timeline = JSON.parse(timelineRaw) as Record<string, unknown>
    expect((timeline['platform'] as Record<string, unknown>)['os']).toBe('mac')
    expect(timelineRaw).toContain(DRAFT_PATH_PLACEHOLDER)
    expect(timeline['id']).not.toBe(source.draftId)

    // Volatile files dropped; cover present for the CapCut grid.
    expect(existsSync(join(result.folderPath, 'draft_info.json.bak'))).toBe(false)
    expect(existsSync(join(result.folderPath, 'template-2.tmp'))).toBe(false)
    expect(existsSync(join(result.folderPath, 'draft_cover.jpg'))).toBe(true)

    // Registry lists the copy.
    const registry = JSON.parse(
      readFileSync(join(env!.draftRoot, 'root_meta_info.json'), 'utf8')
    ) as { all_draft_store: { draft_name?: string }[] }
    expect(registry.all_draft_store.some((e) => e.draft_name === result.draftName)).toBe(true)

    console.log(
      `[e2e] ✅ done — open CapCut and verify "${result.draftName}" appears and plays correctly.`
    )
  }, 120000)
})
