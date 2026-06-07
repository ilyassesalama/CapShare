import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import { PassThrough, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import yazl from 'yazl'
import { CapShareError } from './errors'

export interface ZipProgress {
  processedBytes: number
}

export interface ZipWriterEntryFile {
  kind: 'file'
  absPath: string
  zipPath: string
  /** Pre-read content to use instead of reading from disk (snapshot entries). */
  snapshot?: Buffer
}

export interface ZipWriterEntryBuffer {
  kind: 'buffer'
  data: Buffer
  zipPath: string
  /** Exclude from byte-progress (e.g. the manifest, unknown at planning time). */
  uncounted?: boolean
}

export type ZipWriterEntry = ZipWriterEntryFile | ZipWriterEntryBuffer

export interface AddedEntry {
  zipPath: string
  size: number
  sha256: string
}

/**
 * Streaming zip writer around yazl: one read pass per file computes the
 * SHA-256 inline while bytes flow into the archive (ZIP64-capable, no
 * whole-file buffering). `compress: false` for already-compressed media would
 * be possible, but uniform deflate keeps the format simple.
 */
export class ZipWriter {
  private readonly zip = new yazl.ZipFile()
  private readonly done: Promise<void>
  private readonly onBytes?: (chunkLength: number) => void
  private aborted = false

  constructor(destPath: string, onBytes?: (chunkLength: number) => void) {
    this.onBytes = onBytes
    const out = createWriteStream(destPath)
    this.done = pipeline(this.zip.outputStream, out)
  }

  /** Adds one entry, resolving with its size + sha256 once fully consumed. */
  async add(entry: ZipWriterEntry, signal?: AbortSignal): Promise<AddedEntry> {
    if (signal?.aborted || this.aborted) {
      this.aborted = true
      throw new CapShareError('CANCELLED', 'Operation cancelled')
    }

    if (entry.kind === 'buffer' || entry.snapshot) {
      const data = entry.kind === 'buffer' ? entry.data : entry.snapshot!
      const sha256 = createHash('sha256').update(data).digest('hex')
      this.zip.addBuffer(data, entry.zipPath)
      if (!(entry.kind === 'buffer' && entry.uncounted)) this.onBytes?.(data.length)
      return { zipPath: entry.zipPath, size: data.length, sha256 }
    }

    const hash = createHash('sha256')
    let size = 0
    const onBytes = this.onBytes
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk)
        size += chunk.length
        onBytes?.(chunk.length)
        cb(null, chunk)
      }
    })

    const source = createReadStream(entry.absPath)
    const tee = new PassThrough()
    // yazl consumes `tee`; the pipeline below resolves when the file is fully read.
    this.zip.addReadStream(tee, entry.zipPath)
    await pipeline(source, counter, tee, { signal })
    return { zipPath: entry.zipPath, size, sha256: hash.digest('hex') }
  }

  /** Finalizes the archive and waits for the destination file to be flushed. */
  async finish(): Promise<void> {
    this.zip.end()
    await this.done
  }
}

// --- Reading -----------------------------------------------------------------

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) reject(err ?? new Error('Failed to open archive'))
      else resolve(zip)
    })
  })
}

function entryToBuffer(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) return reject(err ?? new Error('Failed to read entry'))
      const chunks: Buffer[] = []
      stream.on('data', (c: Buffer) => chunks.push(c))
      stream.on('end', () => resolve(Buffer.concat(chunks)))
      stream.on('error', reject)
    })
  })
}

/**
 * Reads selected entries of an archive into memory (small entries only —
 * manifest, cover). Resolves with a map of the found entries; stops early
 * once all requested names were seen.
 */
export async function readZipEntries(
  zipPath: string,
  names: readonly string[]
): Promise<Map<string, Buffer>> {
  const zip = await openZip(zipPath)
  const wanted = new Set(names)
  const found = new Map<string, Buffer>()

  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject)
      zip.on('entry', (entry: yauzl.Entry) => {
        if (wanted.has(entry.fileName)) {
          entryToBuffer(zip, entry)
            .then((buf) => {
              found.set(entry.fileName, buf)
              if (found.size === wanted.size) resolve()
              else zip.readEntry()
            })
            .catch(reject)
        } else {
          zip.readEntry()
        }
      })
      zip.on('end', () => resolve())
      zip.readEntry()
    })
  } finally {
    zip.close()
  }
  return found
}

/** Guards against zip-slip: entry names must stay inside the destination. */
function safeJoin(destDir: string, entryName: string): string {
  if (entryName.includes('..') || entryName.startsWith('/') || /^[A-Za-z]:/.test(entryName)) {
    throw new CapShareError('ARCHIVE_INVALID', `Unsafe entry path in archive: ${entryName}`)
  }
  const resolved = normalize(join(destDir, entryName))
  if (!resolved.startsWith(normalize(destDir) + sep)) {
    throw new CapShareError('ARCHIVE_INVALID', `Entry escapes destination: ${entryName}`)
  }
  return resolved
}

export interface ExtractOptions {
  /** Map an entry name to a destination-relative path, or null to skip it. */
  mapEntry: (entryName: string) => string | null
  onBytes?: (chunkLength: number) => void
  signal?: AbortSignal
}

/** Streams matching entries of the archive into destDir (zip-slip safe). */
export async function extractZip(
  zipPath: string,
  destDir: string,
  options: ExtractOptions
): Promise<{ files: number }> {
  const zip = await openZip(zipPath)
  let files = 0

  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject)
      zip.on('entry', (entry: yauzl.Entry) => {
        if (options.signal?.aborted) {
          return reject(new CapShareError('CANCELLED', 'Operation cancelled'))
        }
        if (/\/$/.test(entry.fileName)) {
          zip.readEntry()
          return
        }
        const mapped = options.mapEntry(entry.fileName)
        if (mapped === null) {
          zip.readEntry()
          return
        }
        const target = safeJoin(destDir, mapped)
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return reject(err ?? new Error('Failed to read entry'))
          const onBytes = options.onBytes
          const counter = new Transform({
            transform(chunk: Buffer, _enc, cb) {
              onBytes?.(chunk.length)
              cb(null, chunk)
            }
          })
          mkdir(dirname(target), { recursive: true })
            .then(() => pipeline(stream, counter, createWriteStream(target)))
            .then(() => {
              files++
              zip.readEntry()
            })
            .catch(reject)
        })
      })
      zip.on('end', () => resolve())
      zip.readEntry()
    })
  } finally {
    zip.close()
  }
  return { files }
}
