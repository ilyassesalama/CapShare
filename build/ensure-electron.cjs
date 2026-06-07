/**
 * Electron ≥42 ships no postinstall — the binary downloads lazily on first
 * `electron .` run. That's too late for packaging and flaky under CI, so we
 * fetch it explicitly at install time (no-op when already present, and
 * honors ELECTRON_SKIP_BINARY_DOWNLOAD for test-only CI jobs).
 */
const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')

if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD === '1') {
  process.exit(0)
}

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron')
const pathFile = path.join(electronDir, 'path.txt')

if (!existsSync(electronDir)) {
  // Dependencies not installed yet (e.g. lint-only checkout) — nothing to do.
  process.exit(0)
}

if (!existsSync(pathFile)) {
  execFileSync(process.execPath, [path.join(electronDir, 'install.js')], { stdio: 'inherit' })
}
