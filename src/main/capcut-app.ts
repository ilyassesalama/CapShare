import { exec } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { shell } from 'electron'

const execAsync = promisify(exec)

/** Best-effort check whether CapCut is currently running. */
export async function isCapCutRunning(): Promise<boolean> {
  try {
    if (process.platform === 'darwin') {
      const { stdout } = await execAsync('pgrep -x CapCut || true')
      return stdout.trim().length > 0
    }
    if (process.platform === 'win32') {
      const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq CapCut.exe" /NH')
      return stdout.toLowerCase().includes('capcut.exe')
    }
  } catch {
    // Detection failure → assume not running (warning-grade feature only).
  }
  return false
}

/** Launches CapCut, returning false when no installation could be found. */
export async function launchCapCut(): Promise<boolean> {
  if (process.platform === 'darwin') {
    const appPath = '/Applications/CapCut.app'
    if (existsSync(appPath)) {
      const error = await shell.openPath(appPath)
      return error === ''
    }
    return false
  }
  if (process.platform === 'win32') {
    const local = process.env['LOCALAPPDATA']
    const candidates = [
      local ? join(local, 'CapCut', 'Apps', 'CapCut.exe') : null,
      local ? join(local, 'CapCut', 'CapCut.exe') : null
    ].filter((p): p is string => p !== null)
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        const error = await shell.openPath(candidate)
        return error === ''
      }
    }
    return false
  }
  return false
}
