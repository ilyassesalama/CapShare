import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/channels'
import type {
  AppSettings,
  ExportResult,
  ImportPreview,
  ImportResult,
  IpcResult,
  ProgressEvent,
  ProjectsResponse
} from '../shared/types'

/**
 * The typed bridge exposed to the renderer as `window.capshare`.
 * One wrapper per IPC channel — `ipcRenderer` itself is never exposed.
 * Invoke-style calls resolve with IpcResult envelopes; event subscriptions
 * return unsubscribe functions.
 */
const api = {
  /** Announce the renderer is ready; resolves with a pending .capshare path if the app was opened via a file. */
  rendererReady: (): Promise<string | null> => ipcRenderer.invoke(IPC.rendererReady),

  /** Subscribe to OS open-file requests. Returns an unsubscribe function. */
  onOpenFile: (callback: (filePath: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, filePath: string): void =>
      callback(filePath)
    ipcRenderer.on(IPC.openFile, handler)
    return () => ipcRenderer.removeListener(IPC.openFile, handler)
  },

  /** Subscribe to long-task progress events. Returns an unsubscribe function. */
  onProgress: (callback: (event: ProgressEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ProgressEvent): void =>
      callback(progress)
    ipcRenderer.on(IPC.progress, handler)
    return () => ipcRenderer.removeListener(IPC.progress, handler)
  },

  listProjects: (): Promise<IpcResult<ProjectsResponse>> => ipcRenderer.invoke(IPC.listProjects),

  pickExportDestination: (defaultName: string): Promise<IpcResult<string | null>> =>
    ipcRenderer.invoke(IPC.pickExportDestination, defaultName),

  runExport: (request: {
    taskId: string
    folderPath: string
    destinationPath: string
    includeCaches: boolean
  }): Promise<IpcResult<ExportResult>> => ipcRenderer.invoke(IPC.runExport, request),

  pickImportFile: (): Promise<IpcResult<string | null>> => ipcRenderer.invoke(IPC.pickImportFile),

  inspectImport: (filePath: string): Promise<IpcResult<ImportPreview>> =>
    ipcRenderer.invoke(IPC.inspectImport, filePath),

  runImport: (request: {
    taskId: string
    filePath: string
    resolution?: 'copy' | 'replace'
  }): Promise<IpcResult<ImportResult>> => ipcRenderer.invoke(IPC.runImport, request),

  cancelTask: (taskId: string): Promise<IpcResult<boolean>> =>
    ipcRenderer.invoke(IPC.cancelTask, taskId),

  getSettings: (): Promise<IpcResult<AppSettings>> => ipcRenderer.invoke(IPC.getSettings),

  setSettings: (update: Partial<AppSettings>): Promise<IpcResult<AppSettings>> =>
    ipcRenderer.invoke(IPC.setSettings, update),

  revealPath: (path: string): Promise<IpcResult<void>> => ipcRenderer.invoke(IPC.revealPath, path),

  launchCapCut: (): Promise<IpcResult<boolean>> => ipcRenderer.invoke(IPC.launchCapCut),

  isCapCutRunning: (): Promise<IpcResult<boolean>> => ipcRenderer.invoke(IPC.isCapCutRunning),

  pickFolder: (title: string): Promise<IpcResult<string | null>> =>
    ipcRenderer.invoke(IPC.pickFolder, title),

  /** Resolves the filesystem path of a dropped File (File.path was removed in modern Electron). */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file)
}

export type CapShareApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('capshare', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (defined in index.d.ts)
  window.capshare = api
}
