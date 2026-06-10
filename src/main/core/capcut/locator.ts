import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { DRAFT_DIR_NAME } from './constants'
import type { CapCutEnv, CapCutOs } from './model'

/** Converts a filesystem path to the forward-slash form CapCut writes into JSON. */
export function toJsonPath(p: string): string {
  return p.replace(/\\/g, '/')
}

function capCutOsForPlatform(platform: NodeJS.Platform): CapCutOs | null {
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32') return 'windows'
  return null
}

export interface LocatorOptions {
  platform: NodeJS.Platform
  homeDir: string
  /** %LOCALAPPDATA% on Windows. */
  localAppData?: string | null
  /** User-configured draft root (the com.lveditor.draft folder) from settings. */
  draftRootOverride?: string | null
}

/**
 * Candidate `User Data` directories for this machine, most canonical first.
 *
 * macOS: CapCut is sandboxed — `~/Movies/CapCut` and the container path under
 * `~/Library/Containers/com.lemon.lvoverseas` resolve to the same directory,
 * but CapCut writes the *container* spelling into draft JSON, so that form is
 * canonical for JSON values while either works for fs access.
 *
 * Windows: `%LOCALAPPDATA%\CapCut\User Data` by default; the draft location is
 * user-configurable in CapCut settings, so a Documents fallback is probed too.
 */
function candidateUserDataDirs(opts: LocatorOptions): string[] {
  if (opts.platform === 'darwin') {
    return [
      join(opts.homeDir, 'Movies', 'CapCut', 'User Data'),
      join(
        opts.homeDir,
        'Library',
        'Containers',
        'com.lemon.lvoverseas',
        'Data',
        'Movies',
        'CapCut',
        'User Data'
      )
    ]
  }
  if (opts.platform === 'win32') {
    const local = opts.localAppData ?? join(opts.homeDir, 'AppData', 'Local')
    return [
      join(local, 'CapCut', 'User Data'),
      join(opts.homeDir, 'Documents', 'CapCut', 'User Data')
    ]
  }
  return []
}

/** The JSON spelling of the cache dir CapCut itself uses on this machine. */
function canonicalCacheDirJson(os: CapCutOs, userDataDir: string, opts: LocatorOptions): string {
  if (os === 'mac') {
    // Always the sandbox-container spelling, regardless of which alias we found.
    return toJsonPath(
      join(
        opts.homeDir,
        'Library',
        'Containers',
        'com.lemon.lvoverseas',
        'Data',
        'Movies',
        'CapCut',
        'User Data',
        'Cache'
      )
    )
  }
  return toJsonPath(join(userDataDir, 'Cache'))
}

/**
 * Detects the CapCut environment on this machine.
 * Returns null when CapCut's draft directory cannot be found (and no override given).
 */
export function detectCapCutEnv(opts: LocatorOptions): CapCutEnv | null {
  const os = capCutOsForPlatform(opts.platform)
  if (!os) return null

  if (opts.draftRootOverride) {
    if (!existsSync(opts.draftRootOverride)) return null
    // <User Data>/Projects/com.lveditor.draft → <User Data>
    const userDataDir = dirname(dirname(opts.draftRootOverride))
    return {
      os,
      userDataDir,
      draftRoot: opts.draftRootOverride,
      cacheDir: join(userDataDir, 'Cache'),
      canonicalCacheDirJson: canonicalCacheDirJson(os, userDataDir, opts),
      fromOverride: true
    }
  }

  for (const userDataDir of candidateUserDataDirs(opts)) {
    const draftRoot = join(userDataDir, 'Projects', DRAFT_DIR_NAME)
    if (existsSync(draftRoot)) {
      return {
        os,
        userDataDir,
        draftRoot,
        cacheDir: join(userDataDir, 'Cache'),
        canonicalCacheDirJson: canonicalCacheDirJson(os, userDataDir, opts),
        fromOverride: false
      }
    }
  }
  return null
}

/** Convenience wrapper using the real process environment. */
export function detectCapCutEnvFromProcess(draftRootOverride?: string | null): CapCutEnv | null {
  return detectCapCutEnv({
    platform: process.platform,
    homeDir: process.env['HOME'] ?? process.env['USERPROFILE'] ?? '',
    localAppData: process.env['LOCALAPPDATA'] ?? null,
    draftRootOverride: draftRootOverride ?? null
  })
}
