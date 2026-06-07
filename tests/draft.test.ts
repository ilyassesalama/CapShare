import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  findTimelinePath,
  listDraftSummaries,
  parseDraft,
  readDraftSummary
} from '../src/main/core/capcut/draft'
import { CapShareError } from '../src/main/core/errors'
import { createMacDraft, createWinFlavoredDraftFolder, makeMacMachine } from './fixtures/factory'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'capshare-draft-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('findTimelinePath', () => {
  it('finds draft_info.json on mac-flavored drafts', () => {
    const machine = makeMacMachine(tmp)
    const draft = createMacDraft(machine)
    const paths = findTimelinePath(draft.folder)
    expect(paths?.timelineFilename).toBe('draft_info.json')
    expect(paths?.coverPath).not.toBeNull()
  })

  it('finds draft_content.json on windows-flavored drafts', () => {
    const win = createWinFlavoredDraftFolder(tmp)
    const paths = findTimelinePath(win.folder)
    expect(paths?.timelineFilename).toBe('draft_content.json')
  })

  it('returns null when no timeline exists', () => {
    expect(findTimelinePath(tmp)).toBeNull()
  })
})

describe('parseDraft', () => {
  it('throws DRAFT_ENCRYPTED for non-JSON timeline content', async () => {
    const machine = makeMacMachine(tmp)
    const draft = createMacDraft(machine, { name: 'Enc' })
    writeFileSync(join(draft.folder, 'draft_info.json'), Buffer.from([0x01, 0x02, 0x03, 0x04]))
    await expect(parseDraft(draft.folder)).rejects.toMatchObject({ code: 'DRAFT_ENCRYPTED' })
  })

  it('throws DRAFT_NOT_FOUND for folders without a timeline', async () => {
    await expect(parseDraft(tmp)).rejects.toSatisfy(
      (e: unknown) => e instanceof CapShareError && e.code === 'DRAFT_NOT_FOUND'
    )
  })
})

describe('readDraftSummary', () => {
  it('builds a full preview summary from the fixture draft', async () => {
    const machine = makeMacMachine(tmp)
    const draft = createMacDraft(machine, { name: 'Summer Trip' })
    const summary = await readDraftSummary(draft.folder)

    expect(summary.name).toBe('Summer Trip')
    expect(summary.draftId).toBe(draft.metaDraftId)
    expect(summary.durationUs).toBe(12000000)
    expect(summary.fps).toBe(30)
    expect(summary.canvas).toEqual({ width: 1080, height: 1920 })
    expect(summary.capcutVersion).toBe('8.7.0')
    expect(summary.timelineFile).toBe('draft_info.json')
    expect(summary.coverDataUrl).toMatch(/^data:image\/jpeg;base64,/)
    expect(summary.sizeBytes).toBeGreaterThan(2048) // includes the matting cache
    expect(summary.modifiedAt).toBe(Math.round(1780765223363020 / 1000))

    const types = summary.tracks.map((t) => t.type)
    expect(types).toEqual(['video', 'audio', 'text'])
    expect(summary.tracks[0].segments[0]).toMatchObject({
      startUs: 0,
      durationUs: 8000000,
      label: 'clip-one.mp4'
    })
    // Text labels come from the embedded JSON content.
    expect(summary.tracks[2].segments[0].label).toBe('Hello CapShare')
    expect(summary.mediaCounts).toEqual({ video: 1, audio: 1, image: 0 })
  })
})

describe('listDraftSummaries', () => {
  it('lists drafts sorted by modification time and skips junk dirs', async () => {
    const machine = makeMacMachine(tmp)
    createMacDraft(machine, { name: 'Older', modifiedUs: 1780000000000000 })
    createMacDraft(machine, { name: 'Newer', modifiedUs: 1780765223363020 })

    const { drafts, warnings } = await listDraftSummaries(machine.draftRoot)
    expect(warnings).toEqual([])
    expect(drafts.map((d) => d.name)).toEqual(['Newer', 'Older'])
  })

  it('reports unreadable drafts as warnings without failing the listing', async () => {
    const machine = makeMacMachine(tmp)
    createMacDraft(machine, { name: 'Good' })
    const bad = createMacDraft(machine, { name: 'Bad' })
    writeFileSync(join(bad.folder, 'draft_info.json'), 'NOT JSON AT ALL')

    const { drafts, warnings } = await listDraftSummaries(machine.draftRoot)
    expect(drafts.map((d) => d.name)).toEqual(['Good'])
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain('Bad')
  })
})
