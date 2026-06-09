import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import type { UpdaterController } from './updater'

interface MenuContext {
  updater: UpdaterController
}

/**
 * Installs the macOS application menu with a "Check for Updates…" item under the
 * app name, next to About. Other platforms keep Electron's default menu — the
 * Settings → About row covers update checks there.
 */
export function buildAppMenu(ctx: MenuContext): void {
  if (process.platform !== 'darwin') return

  app.setAboutPanelOptions({
    applicationName: app.name,
    applicationVersion: app.getVersion(),
    copyright: `© ${new Date().getFullYear()} Ilyasse Salama`
  })

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: () => void ctx.updater.checkInteractive() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
