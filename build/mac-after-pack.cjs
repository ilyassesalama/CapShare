/**
 * Unsigned fallback builds: ad-hoc deep-sign the packed app so it still
 * launches on Apple Silicon.
 */
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function macAfterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  // Only ad-hoc sign in the explicit fallback path (CSC_IDENTITY_AUTO_DISCOVERY
  // =false). In every other case — including a real Developer ID build — we leave
  // the bundle alone: electron-builder signs (and notarizes) it itself, and an
  // ad-hoc deep sign here would clobber that signature.
  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY !== 'false') return
  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}
