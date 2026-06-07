import { CACHE_PATH_MARKER, DRAFT_PATH_PLACEHOLDER } from './constants'

/**
 * Classification of a string value found inside draft JSON.
 *
 * Only `effect-cache`, `draft-internal` and (fs-verified) `absolute` strings
 * are ever rewritten; `url` and `relative` are never touched, and `absolute`
 * strings are only acted on when the export pipeline confirmed they exist on
 * disk — the classifier alone never triggers a blind rewrite.
 */
export type PathClass =
  | 'placeholder'
  | 'url'
  | 'effect-cache'
  | 'draft-internal'
  | 'absolute'
  | 'unc'
  | 'relative'

export interface ScanContext {
  /** Forward-slash absolute path of the draft folder, when known. */
  draftFolderJson?: string | null
}

export interface ScannedString {
  /** JSON-pointer-ish location for diagnostics, e.g. /materials/videos/3/path. */
  pointer: string
  /** The raw string value as found. */
  value: string
  /** Forward-slash form of the value. */
  normalized: string
  cls: PathClass
  /** For effect-cache: the portion after 'User Data/Cache/', e.g. 'effect/123/ab'. */
  cacheSuffix?: string
  /** For draft-internal: the portion relative to the draft folder. */
  draftRelative?: string
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i
const WIN_DRIVE_RE = /^[A-Za-z]:\//

export function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/')
}

export function classifyString(
  value: string,
  ctx: ScanContext = {}
): Pick<ScannedString, 'cls' | 'normalized' | 'cacheSuffix' | 'draftRelative'> {
  const normalized = normalizeSlashes(value)

  if (normalized.startsWith(DRAFT_PATH_PLACEHOLDER)) {
    return { cls: 'placeholder', normalized }
  }
  if (SCHEME_RE.test(value)) {
    return { cls: 'url', normalized }
  }
  if (normalized.startsWith('//')) {
    return { cls: 'unc', normalized }
  }

  const isWinAbs = WIN_DRIVE_RE.test(normalized)
  const isPosixAbs = normalized.startsWith('/') && normalized.length > 1
  if (!isWinAbs && !isPosixAbs) {
    return { cls: 'relative', normalized }
  }

  const cacheIdx = normalized.indexOf(CACHE_PATH_MARKER)
  if (cacheIdx !== -1) {
    return {
      cls: 'effect-cache',
      normalized,
      cacheSuffix: normalized.slice(cacheIdx + CACHE_PATH_MARKER.length)
    }
  }

  const draftFolder = ctx.draftFolderJson
  if (draftFolder) {
    // Windows paths are case-insensitive; macOS defaults are too (HFS+/APFS).
    const folderLower = draftFolder.toLowerCase().replace(/\/+$/, '')
    const valueLower = normalized.toLowerCase()
    if (valueLower.startsWith(folderLower + '/')) {
      return {
        cls: 'draft-internal',
        normalized,
        draftRelative: normalized.slice(folderLower.length + 1)
      }
    }
  }

  return { cls: 'absolute', normalized }
}

/**
 * Walks every string value in a parsed JSON tree, calling `visit` for each.
 * When `visit` returns a string, the value is replaced in place.
 *
 * Strings that themselves contain serialized JSON objects/arrays are parsed
 * and walked recursively; if anything inside changed, the string is
 * re-serialized. Returns true when at least one value was modified.
 */
export function walkJsonStrings(
  root: unknown,
  visit: (value: string, pointer: string) => string | undefined
): boolean {
  let changed = false

  const handleString = (value: string, pointer: string): string | undefined => {
    const direct = visit(value, pointer)
    if (direct !== undefined) return direct

    // Embedded JSON payloads (CapCut stores JSON-in-strings in several fields).
    const trimmed = value.trimStart()
    if (
      (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
      (value.includes('/') || value.includes('\\'))
    ) {
      try {
        const inner = JSON.parse(value) as unknown
        if (inner !== null && typeof inner === 'object') {
          const innerChanged = walkInner(inner, `${pointer}~json`)
          if (innerChanged) return JSON.stringify(inner)
        }
      } catch {
        // Not valid JSON — leave untouched.
      }
    }
    return undefined
  }

  const walkInner = (node: unknown, pointer: string): boolean => {
    let localChanged = false
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const child = node[i]
        if (typeof child === 'string') {
          const next = handleString(child, `${pointer}/${i}`)
          if (next !== undefined) {
            node[i] = next
            localChanged = true
          }
        } else if (child !== null && typeof child === 'object') {
          localChanged = walkInner(child, `${pointer}/${i}`) || localChanged
        }
      }
    } else if (node !== null && typeof node === 'object') {
      const record = node as Record<string, unknown>
      for (const key of Object.keys(record)) {
        const child = record[key]
        if (typeof child === 'string') {
          const next = handleString(child, `${pointer}/${key}`)
          if (next !== undefined) {
            record[key] = next
            localChanged = true
          }
        } else if (child !== null && typeof child === 'object') {
          localChanged = walkInner(child, `${pointer}/${key}`) || localChanged
        }
      }
    }
    return localChanged
  }

  changed = walkInner(root, '')
  return changed
}

/** Read-only scan: collects every string with a non-trivial classification. */
export function collectPaths(root: unknown, ctx: ScanContext = {}): ScannedString[] {
  const found: ScannedString[] = []
  walkJsonStrings(root, (value, pointer) => {
    const result = classifyString(value, ctx)
    if (result.cls !== 'relative') {
      found.push({ pointer, value, ...result })
    }
    return undefined
  })
  return found
}

// --- Rewriting --------------------------------------------------------------

export type RewriteRule =
  | { kind: 'exact'; from: string; to: string }
  | { kind: 'prefix'; from: string; to: string; caseInsensitive?: boolean }

/**
 * Builds a visitor for walkJsonStrings that applies the given rules.
 * Matching happens on the forward-slash-normalized value; replacements always
 * emit forward slashes (CapCut's native style on both OSes). URLs are never
 * rewritten regardless of rules.
 */
export function makeRewriter(rules: RewriteRule[]): (value: string) => string | undefined {
  return (value: string): string | undefined => {
    if (SCHEME_RE.test(value)) return undefined
    const normalized = normalizeSlashes(value)

    for (const rule of rules) {
      if (rule.kind === 'exact') {
        if (normalized === normalizeSlashes(rule.from)) return rule.to
      } else {
        const from = normalizeSlashes(rule.from).replace(/\/+$/, '')
        const haystack = rule.caseInsensitive ? normalized.toLowerCase() : normalized
        const needle = rule.caseInsensitive ? from.toLowerCase() : from
        if (haystack.startsWith(needle + '/') || haystack === needle) {
          return rule.to + normalized.slice(from.length)
        }
      }
    }
    return undefined
  }
}
