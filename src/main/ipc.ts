import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import { join } from 'node:path'
import log from 'electron-log/main'
import { z } from 'zod'
import { IPC } from '../shared/channels'
import type {
  AppSettings,
  ExportResult,
  ImportPreview,
  ImportResult,
  IpcResult,
  ProgressEvent,
  ProjectsResponse,
  UpdateProjectResult
} from '../shared/types'
import { isCapCutRunning, launchCapCut } from './capcut-app'
import { deleteDraft } from './core/capcut/delete'
import { listDraftSummaries } from './core/capcut/draft'
import { detectCapCutEnvFromProcess } from './core/capcut/locator'
import type { CapCutEnv } from './core/capcut/model'
import { updateDraft } from './core/capcut/update'
import { exportDraft } from './core/capshare/export'
import { importCapshare, inspectCapshare } from './core/capshare/import'
import { CapShareError } from './core/errors'
import { getSettings, setSettings } from './settings'

interface IpcContext {
  getMainWindow: () => BrowserWindow | null
  consumePendingOpenFile: () => string | null
}

/** Sends an OS open-file request to the renderer. */
export function notifyOpenFile(window: BrowserWindow, filePath: string): void {
  window.webContents.send(IPC.openFile, filePath)
}

function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

function fail<T>(error: unknown): IpcResult<T> {
  const shaped = CapShareError.wrap(error)
  log.error(`[ipc] ${shaped.code}: ${shaped.message}`, shaped.detail ?? '')
  return { ok: false, error: shaped.toShape() }
}

function currentEnv(): CapCutEnv | null {
  return detectCapCutEnvFromProcess(getSettings().draftRootOverride)
}

function requireEnv(): CapCutEnv {
  const env = currentEnv()
  if (!env) {
    throw new CapShareError(
      'CAPCUT_NOT_FOUND',
      'No CapCut installation found on this machine. Set the project folder manually in Settings.'
    )
  }
  return env
}

/** Active long-running operations, cancellable from the renderer by taskId. */
const activeTasks = new Map<string, AbortController>()

function makeProgressForwarder(
  ctx: IpcContext,
  taskId: string
): (processedBytes: number, totalBytes: number, phase: string) => void {
  let lastSent = 0
  let lastRatio = -1
  return (processedBytes, totalBytes, phase) => {
    const now = Date.now()
    const ratio = totalBytes > 0 ? Math.min(processedBytes / totalBytes, 1) : 0
    // Throttle: at most ~10 events/s, but always deliver meaningful jumps.
    if (now - lastSent < 100 && ratio - lastRatio < 0.05 && ratio < 1) return
    lastSent = now
    lastRatio = ratio
    const win = ctx.getMainWindow()
    if (win && !win.isDestroyed()) {
      const event: ProgressEvent = { taskId, phase, processedBytes, totalBytes, ratio }
      win.webContents.send(IPC.progress, event)
    }
  }
}

const taskIdSchema = z.string().min(1).max(128)

const exportRequestSchema = z.object({
  taskId: taskIdSchema,
  folderPath: z.string().min(1),
  destinationPath: z.string().min(1),
  includeCaches: z.boolean()
})

const importRequestSchema = z.object({
  taskId: taskIdSchema,
  filePath: z.string().min(1),
  resolution: z.enum(['copy', 'replace']).optional()
})

const deleteRequestSchema = z.object({
  folderPath: z.string().min(1),
  draftId: z.string().min(1)
})

const JPEG_DATA_URL_PREFIX = 'data:image/jpeg;base64,'

const updateRequestSchema = z.object({
  folderPath: z.string().min(1),
  draftId: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  coverDataUrl: z.string().startsWith(JPEG_DATA_URL_PREFIX).optional()
})

/** Longest cover edge written to draft_cover.jpg — covers are card-sized thumbnails. */
const COVER_MAX_EDGE = 1280

const settingsUpdateSchema = z.object({
  draftRootOverride: z.string().nullable().optional(),
  defaultExportDir: z.string().nullable().optional(),
  includeCachesByDefault: z.boolean().optional(),
  theme: z.enum(['system', 'light', 'dark']).optional()
})

/**
 * Registers all ipcMain handlers. Handlers delegate to the pure core modules
 * (src/main/core); this layer only validates inputs, shapes errors, and
 * forwards progress.
 */
export function registerIpcHandlers(ctx: IpcContext): void {
  ipcMain.handle(IPC.rendererReady, () => {
    return ctx.consumePendingOpenFile()
  })

  ipcMain.handle(IPC.listProjects, async (): Promise<IpcResult<ProjectsResponse>> => {
    try {
      const env = currentEnv()
      if (!env) {
        return ok({ found: false, draftRoot: null, os: null, drafts: [], warnings: [] })
      }
      const { drafts, warnings } = await listDraftSummaries(env.draftRoot)
      return ok({ found: true, draftRoot: env.draftRoot, os: env.os, drafts, warnings })
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC.deleteProject, async (_event, raw: unknown): Promise<IpcResult<void>> => {
    try {
      const request = deleteRequestSchema.parse(raw)
      const env = requireEnv()
      await deleteDraft({
        draftRoot: env.draftRoot,
        folderPath: request.folderPath,
        draftId: request.draftId,
        trashFolder: (path) => shell.trashItem(path)
      })
      return ok(undefined)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC.pickProjectCover, async (): Promise<IpcResult<string | null>> => {
    try {
      const win = ctx.getMainWindow()
      const result = await dialog.showOpenDialog(win!, {
        title: 'Choose thumbnail image',
        properties: ['openFile'],
        // nativeImage only decodes PNG/JPEG reliably — don't advertise more.
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
      })
      if (result.canceled || result.filePaths.length === 0) return ok(null)

      const image = nativeImage.createFromPath(result.filePaths[0])
      if (image.isEmpty()) {
        throw new CapShareError(
          'UPDATE_FAILED',
          'Could not read that image. Choose a PNG or JPEG file.'
        )
      }
      const { width, height } = image.getSize()
      const resized =
        Math.max(width, height) <= COVER_MAX_EDGE
          ? image
          : width >= height
            ? image.resize({ width: COVER_MAX_EDGE })
            : image.resize({ height: COVER_MAX_EDGE })
      const jpeg = resized.toJPEG(85)
      return ok(`data:image/jpeg;base64,${jpeg.toString('base64')}`)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    IPC.updateProject,
    async (_event, raw: unknown): Promise<IpcResult<UpdateProjectResult>> => {
      try {
        const request = updateRequestSchema.parse(raw)
        const env = requireEnv()
        const result = await updateDraft({
          draftRoot: env.draftRoot,
          folderPath: request.folderPath,
          draftId: request.draftId,
          newName: request.name,
          coverJpeg: request.coverDataUrl
            ? Buffer.from(request.coverDataUrl.slice(JPEG_DATA_URL_PREFIX.length), 'base64')
            : undefined,
          os: env.os
        })
        return ok(result)
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    IPC.pickExportDestination,
    async (_event, defaultName: unknown): Promise<IpcResult<string | null>> => {
      try {
        const win = ctx.getMainWindow()
        const name = typeof defaultName === 'string' && defaultName ? defaultName : 'Project'
        const settings = getSettings()
        const result = await dialog.showSaveDialog(win!, {
          title: 'Export .capshare',
          defaultPath: join(
            settings.defaultExportDir ?? app.getPath('downloads'),
            `${name}.capshare`
          ),
          filters: [{ name: 'CapShare Project', extensions: ['capshare'] }]
        })
        return ok(result.canceled || !result.filePath ? null : result.filePath)
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(IPC.runExport, async (_event, raw: unknown): Promise<IpcResult<ExportResult>> => {
    const controller = new AbortController()
    let taskId = ''
    try {
      const request = exportRequestSchema.parse(raw)
      taskId = request.taskId
      const env = requireEnv()
      activeTasks.set(taskId, controller)

      const result = await exportDraft({
        draftFolder: request.folderPath,
        env,
        destinationPath: request.destinationPath,
        includeCaches: request.includeCaches,
        capshareVersion: app.getVersion(),
        onProgress: makeProgressForwarder(ctx, taskId),
        signal: controller.signal
      })
      return ok(result)
    } catch (error) {
      return fail(error)
    } finally {
      if (taskId) activeTasks.delete(taskId)
    }
  })

  ipcMain.handle(IPC.pickImportFile, async (): Promise<IpcResult<string | null>> => {
    try {
      const win = ctx.getMainWindow()
      const result = await dialog.showOpenDialog(win!, {
        title: 'Open .capshare',
        properties: ['openFile'],
        filters: [{ name: 'CapShare Project', extensions: ['capshare'] }]
      })
      return ok(result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0])
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    IPC.inspectImport,
    async (_event, filePath: unknown): Promise<IpcResult<ImportPreview>> => {
      try {
        const path = z.string().min(1).parse(filePath)
        return ok(await inspectCapshare(path, currentEnv()))
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle(IPC.runImport, async (_event, raw: unknown): Promise<IpcResult<ImportResult>> => {
    const controller = new AbortController()
    let taskId = ''
    try {
      const request = importRequestSchema.parse(raw)
      taskId = request.taskId
      const env = requireEnv()
      activeTasks.set(taskId, controller)

      const result = await importCapshare({
        filePath: request.filePath,
        env,
        resolution: request.resolution,
        backupDir: join(app.getPath('userData'), 'draft-backups'),
        onProgress: makeProgressForwarder(ctx, taskId),
        signal: controller.signal
      })
      return ok(result)
    } catch (error) {
      return fail(error)
    } finally {
      if (taskId) activeTasks.delete(taskId)
    }
  })

  ipcMain.handle(IPC.cancelTask, (_event, taskId: unknown): IpcResult<boolean> => {
    try {
      const id = taskIdSchema.parse(taskId)
      const controller = activeTasks.get(id)
      if (controller) controller.abort()
      return ok(controller !== undefined)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC.getSettings, (): IpcResult<AppSettings> => {
    try {
      return ok(getSettings())
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC.setSettings, async (_event, raw: unknown): Promise<IpcResult<AppSettings>> => {
    try {
      const update = settingsUpdateSchema.parse(raw)
      return ok(await setSettings(update))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC.revealPath, (_event, rawPath: unknown): IpcResult<void> => {
    try {
      const path = z.string().min(1).parse(rawPath)
      shell.showItemInFolder(path)
      return ok(undefined)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC.launchCapCut, async (): Promise<IpcResult<boolean>> => {
    try {
      return ok(await launchCapCut())
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC.isCapCutRunning, async (): Promise<IpcResult<boolean>> => {
    try {
      return ok(await isCapCutRunning())
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    IPC.pickFolder,
    async (_event, title: unknown): Promise<IpcResult<string | null>> => {
      try {
        const win = ctx.getMainWindow()
        const result = await dialog.showOpenDialog(win!, {
          title: typeof title === 'string' ? title : 'Choose folder',
          properties: ['openDirectory']
        })
        return ok(result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0])
      } catch (error) {
        return fail(error)
      }
    }
  )
}
