import { app, BrowserWindow, dialog, ipcMain, type MessageBoxOptions } from 'electron'
import log from 'electron-log/main'
import electronUpdater from 'electron-updater'
import { IPC } from '../shared/channels'
import type { UpdateStatus } from '../shared/types'

// electron-updater ships CommonJS; the named export isn't reliable under the
// ESM bundle, so reach autoUpdater through the default export.
const { autoUpdater } = electronUpdater

interface UpdaterContext {
  getMainWindow: () => BrowserWindow | null
}

/** What setupUpdater hands back so other surfaces (e.g. the macOS menu) can drive it. */
export interface UpdaterController {
  /** Check and report the outcome with native dialogs (for the menu item). */
  checkInteractive: () => Promise<void>
}

/**
 * Last known status, kept so a renderer that mounts mid-flight (or after a
 * window reload) can render the right state without re-triggering a check.
 */
let currentStatus: UpdateStatus = { state: 'idle' }
let wired = false

function setStatus(ctx: UpdaterContext, status: UpdateStatus): void {
  currentStatus = status
  const win = ctx.getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send(IPC.updateStatus, status)
}

/** Updates only work from a signed, packaged build; checks are no-ops in dev. */
async function runCheck(ctx: UpdaterContext): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    setStatus(ctx, { state: 'error', message: 'Updates are only available in the installed app.' })
    return currentStatus
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn('[updater] check failed', message)
    setStatus(ctx, { state: 'error', message })
  }
  return currentStatus
}

function showDialog(ctx: UpdaterContext, options: MessageBoxOptions): Promise<number> {
  const win = ctx.getMainWindow()
  return (
    win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)
  ).then((r) => r.response)
}

/**
 * Menu-initiated check: unlike the silent startup check, this always reports an
 * outcome with a native dialog — the macOS-standard "Check for Updates…" feel.
 */
async function checkInteractive(ctx: UpdaterContext): Promise<void> {
  if (!app.isPackaged) {
    await showDialog(ctx, {
      type: 'info',
      message: 'Updates are unavailable in development',
      detail: 'Run an installed build to check for updates.',
      buttons: ['OK']
    })
    return
  }
  const status = await runCheck(ctx)
  switch (status.state) {
    case 'not-available':
      await showDialog(ctx, {
        type: 'info',
        message: 'You’re up to date',
        detail: `CapShare ${app.getVersion()} is the latest version.`,
        buttons: ['OK']
      })
      break
    case 'available':
    case 'downloading':
      await showDialog(ctx, {
        type: 'info',
        message: 'A new version is available',
        detail:
          'It’s downloading in the background — you’ll be prompted to restart when it’s ready.',
        buttons: ['OK']
      })
      break
    case 'downloaded': {
      const response = await showDialog(ctx, {
        type: 'info',
        message: `Update ${status.version} is ready`,
        detail: 'Restart CapShare to install it.',
        buttons: ['Restart', 'Later'],
        defaultId: 0,
        cancelId: 1
      })
      if (response === 0) autoUpdater.quitAndInstall(false, true)
      break
    }
    case 'error':
      await showDialog(ctx, {
        type: 'error',
        message: 'Couldn’t check for updates',
        detail: status.message,
        buttons: ['OK']
      })
      break
  }
}

/**
 * Wires electron-updater to electron-log, mirrors its lifecycle to the renderer,
 * registers the update IPC surface, and runs one background check on startup.
 * Updates download automatically and install on the next quit; the UI also
 * offers an immediate restart once a build is downloaded.
 */
export function setupUpdater(ctx: UpdaterContext): UpdaterController {
  const controller: UpdaterController = { checkInteractive: () => checkInteractive(ctx) }
  if (wired) return controller
  wired = true

  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => setStatus(ctx, { state: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    setStatus(ctx, { state: 'available', version: info.version })
  )
  autoUpdater.on('update-not-available', () => setStatus(ctx, { state: 'not-available' }))
  autoUpdater.on('download-progress', (progress) =>
    setStatus(ctx, { state: 'downloading', percent: Math.round(progress.percent) })
  )
  autoUpdater.on('update-downloaded', (info) =>
    setStatus(ctx, { state: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', (error) =>
    setStatus(ctx, {
      state: 'error',
      message: error instanceof Error ? error.message : String(error)
    })
  )

  // Plain values (not IpcResult envelopes): the update surface carries its own
  // status model and reports failures through the 'error' state, not throws.
  ipcMain.handle(IPC.getAppVersion, () => app.getVersion())
  ipcMain.handle(IPC.updateGetStatus, () => currentStatus)
  ipcMain.handle(IPC.updateCheck, () => runCheck(ctx))
  ipcMain.handle(IPC.updateInstall, () => {
    // isSilent=false → show the OS install UI; isForceRunAfter=true → relaunch.
    if (currentStatus.state === 'downloaded') autoUpdater.quitAndInstall(false, true)
  })

  // Fire-and-forget: a failed startup check must never block launch.
  if (app.isPackaged) void runCheck(ctx)

  return controller
}
