import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { pipeline } from 'node:stream/promises'

export interface WalkedFile {
  /** Absolute path. */
  absPath: string
  /** Path relative to the walk root, with forward slashes. */
  relPath: string
  size: number
  mtimeMs: number
}

/**
 * Recursively walks files under `root`, never following symlinks (a CapCut
 * draft can sit behind sandbox redirects; following links risks runaway walks).
 * Order is deterministic (sorted per directory).
 */
export async function* walkFiles(
  root: string,
  options: { skip?: (relPath: string, isDir: boolean) => boolean } = {}
): AsyncGenerator<WalkedFile> {
  const { skip } = options

  async function* walk(dir: string): AsyncGenerator<WalkedFile> {
    let entries: string[]
    try {
      entries = (await readdir(dir)).sort()
    } catch {
      return
    }
    for (const name of entries) {
      const absPath = join(dir, name)
      const relPath = relative(root, absPath).split('\\').join('/')
      let stats
      try {
        stats = await lstat(absPath)
      } catch {
        continue
      }
      if (stats.isSymbolicLink()) continue
      if (stats.isDirectory()) {
        if (skip?.(relPath, true)) continue
        yield* walk(absPath)
      } else if (stats.isFile()) {
        if (skip?.(relPath, false)) continue
        yield { absPath, relPath, size: stats.size, mtimeMs: stats.mtimeMs }
      }
    }
  }

  yield* walk(root)
}

/** Total size in bytes of all regular files under root (symlinks excluded). */
export async function dirSize(root: string): Promise<number> {
  let total = 0
  for await (const file of walkFiles(root)) total += file.size
  return total
}

/** Streaming file hash — multi-GB-safe. */
export async function hashFile(
  path: string,
  algorithm: 'sha256' | 'md5' = 'sha256'
): Promise<string> {
  const hash = createHash(algorithm)
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

export function hashString(value: string, algorithm: 'sha256' | 'md5' = 'sha256'): string {
  return createHash(algorithm).update(value).digest('hex')
}

/** Reads and parses a JSON file; the `expect` label improves error messages. */
export async function readJsonFile<T = Record<string, unknown>>(path: string): Promise<T> {
  const raw = await readFile(path, 'utf8')
  return JSON.parse(raw) as T
}

/**
 * Writes a file atomically: write to a sibling temp file, then rename.
 * Rename is atomic on the same volume — readers never observe partial content.
 */
export async function atomicWriteFile(path: string, data: string | Buffer): Promise<void> {
  const tmpPath = join(dirname(path), `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
  await writeFile(tmpPath, data)
  try {
    await rename(tmpPath, path)
  } catch (error) {
    await rm(tmpPath, { force: true })
    throw error
  }
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

/**
 * Sanitizes a draft display name into a folder basename valid on the given OS.
 * Windows forbids <>:"/\|?* plus trailing dots/spaces and reserved device
 * names; macOS mainly forbids '/' and ':'. The display name itself is
 * preserved separately in draft_meta_info.json.
 */
export function sanitizeFolderName(name: string, os: 'mac' | 'windows'): string {
  let safe = name
    // eslint-disable-next-line no-control-regex -- control chars are intentionally stripped
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (os === 'windows') {
    safe = safe.replace(/[. ]+$/g, '')
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(safe)) safe = `${safe}_`
  }
  safe = safe.slice(0, 80).trim()
  return safe.length > 0 ? safe : 'Imported Project'
}

/** Returns `base`, or `base 2`, `base 3`, … — the first name not in `taken`. */
export function uniqueName(base: string, taken: ReadonlySet<string>): string {
  const lowerTaken = new Set([...taken].map((n) => n.toLowerCase()))
  if (!lowerTaken.has(base.toLowerCase())) return base
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`
    if (!lowerTaken.has(candidate.toLowerCase())) return candidate
  }
}
