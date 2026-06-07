import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectCapCutEnv, toJsonPath } from '../src/main/core/capcut/locator'
import { makeMacMachine, makeWinMachine } from './fixtures/factory'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'capshare-locator-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('detectCapCutEnv', () => {
  it('finds the mac draft root under ~/Movies and reports the container cache spelling', () => {
    const machine = makeMacMachine(tmp)
    const env = detectCapCutEnv({ platform: 'darwin', homeDir: machine.homeDir })
    expect(env).not.toBeNull()
    expect(env!.os).toBe('mac')
    expect(env!.draftRoot).toBe(machine.draftRoot)
    expect(env!.cacheDir).toBe(machine.cacheDir)
    expect(env!.canonicalCacheDirJson).toBe(toJsonPath(machine.containerCacheDir))
    expect(env!.fromOverride).toBe(false)
  })

  it('finds the windows draft root under %LOCALAPPDATA%', () => {
    const machine = makeWinMachine(tmp)
    const env = detectCapCutEnv({
      platform: 'win32',
      homeDir: machine.homeDir,
      localAppData: machine.localAppData
    })
    expect(env).not.toBeNull()
    expect(env!.os).toBe('windows')
    expect(env!.draftRoot).toBe(machine.draftRoot)
    expect(env!.canonicalCacheDirJson).toBe(toJsonPath(machine.cacheDir))
  })

  it('returns null when CapCut is not installed', () => {
    expect(detectCapCutEnv({ platform: 'darwin', homeDir: join(tmp, 'empty') })).toBeNull()
  })

  it('honors a user override of the draft root', () => {
    const machine = makeMacMachine(tmp)
    const env = detectCapCutEnv({
      platform: 'darwin',
      homeDir: join(tmp, 'elsewhere'),
      draftRootOverride: machine.draftRoot
    })
    expect(env).not.toBeNull()
    expect(env!.fromOverride).toBe(true)
    expect(env!.draftRoot).toBe(machine.draftRoot)
    expect(env!.cacheDir).toBe(machine.cacheDir)
  })

  it('returns null for unsupported platforms', () => {
    expect(detectCapCutEnv({ platform: 'linux', homeDir: tmp })).toBeNull()
  })
})
