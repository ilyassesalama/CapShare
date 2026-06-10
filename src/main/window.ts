import { BrowserWindow, shell, nativeTheme } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

const isMac = process.platform === 'darwin'
const isWindows = process.platform === 'win32'

/**
 * Creates the main window with macOS-26-style chrome on both platforms:
 * - macOS: hidden-inset title bar + under-window vibrancy (real Liquid Glass backdrop)
 * - Windows 11: hidden title bar with native overlay controls + Mica material
 * The renderer paints its own wallpaper layer so the in-app glass surfaces
 * always have something rich to refract, regardless of OS support.
 */
export function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 660,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 20, y: 22 },
          vibrancy: 'under-window' as const,
          visualEffectState: 'active' as const
        }
      : {}),
    ...(isWindows
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: '#00000000',
            symbolColor: nativeTheme.shouldUseDarkColors ? '#e4e4e7' : '#3f3f46',
            height: 56
          },
          // Acrylic blurs whatever is behind the window (mica only tints from
          // the wallpaper) — matches the macOS under-window vibrancy look.
          backgroundMaterial: 'acrylic' as const
        }
      : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Tahoe-sized corners with vibrancy intact: Electron's pre-Tahoe SDK caps
  // the native radius at ~10px with no API to change it (electron#47514).
  if (isMac) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { setCornerRadius } = require('macos-window-effects') as {
        setCornerRadius: (handle: Buffer, radius: number) => boolean
      }
      const TAHOE_CORNER_RADIUS = 34
      const round = (radius: number): void => {
        setCornerRadius(mainWindow.getNativeWindowHandle(), radius)
      }
      round(TAHOE_CORNER_RADIUS)
      mainWindow.on('enter-full-screen', () => round(0))
      mainWindow.on('leave-full-screen', () => round(TAHOE_CORNER_RADIUS))
    } catch {
      /* stock corners */
    }
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Dev/CI hook: CAPSHARE_SCREENSHOT=/path.png captures the renderer and exits.
  if (process.env['CAPSHARE_SCREENSHOT']) {
    const target = process.env['CAPSHARE_SCREENSHOT']
    setTimeout(() => {
      void mainWindow.webContents.capturePage().then(async (image) => {
        const { writeFile } = await import('node:fs/promises')
        await writeFile(target, image.toPNG())
        const { app } = await import('electron')
        app.quit()
      })
    }, 4500)
  }

  // Keep Windows caption-button glyphs legible when the system theme flips.
  if (isWindows) {
    nativeTheme.on('updated', () => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.setTitleBarOverlay({
          color: '#00000000',
          symbolColor: nativeTheme.shouldUseDarkColors ? '#e4e4e7' : '#3f3f46',
          height: 56
        })
      }
    })
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}
