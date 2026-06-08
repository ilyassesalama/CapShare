/**
 * Ad-hoc universal builds: the lipo merge leaves the main executable and the
 * Electron Framework with mismatched ad-hoc identities ("different Team IDs"
 * at launch). Re-sign the merged bundle uniformly.
 *
 * Must run ONLY on the final universal app — touching the per-arch temp packs
 * (mac-universal-{x64,arm64}-temp) breaks @electron/universal's SHA checks.
 */
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function macAfterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  // Skip when real Developer ID signing is active — electron-builder signs (and
  // notarizes) the merged bundle itself; an ad-hoc deep sign here would clobber
  // that signature. Only ad-hoc sign in the fallback path, where signing is
  // explicitly disabled via CSC_IDENTITY_AUTO_DISCOVERY=false.
  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY !== 'false') return
  // Never touch the pre-merge per-arch packs (mac-universal-{x64,arm64}-temp):
  // altering them breaks @electron/universal's identical-SHA merge checks.
  if (path.basename(context.appOutDir).endsWith('-temp')) return
  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}
