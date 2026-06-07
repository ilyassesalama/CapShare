import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import log from 'electron-log/main'
import type { AppSettings } from '../shared/types'
import { atomicWriteFile } from './core/fsx'

const settingsSchema = z.object({
  draftRootOverride: z.string().nullable().default(null),
  defaultExportDir: z.string().nullable().default(null),
  includeCachesByDefault: z.boolean().default(false),
  theme: z.enum(['system', 'light', 'dark']).default('system')
})

const DEFAULTS: AppSettings = {
  draftRootOverride: null,
  defaultExportDir: null,
  includeCachesByDefault: false,
  theme: 'system'
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

let cached: AppSettings | null = null

export function getSettings(): AppSettings {
  if (cached) return cached
  try {
    const path = settingsPath()
    if (existsSync(path)) {
      cached = settingsSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
      return cached
    }
  } catch (error) {
    log.warn('Failed to read settings, using defaults:', error)
  }
  cached = { ...DEFAULTS }
  return cached
}

export async function setSettings(update: Partial<AppSettings>): Promise<AppSettings> {
  const next = settingsSchema.parse({ ...getSettings(), ...update })
  cached = next
  await atomicWriteFile(settingsPath(), JSON.stringify(next, null, 2))
  return next
}
