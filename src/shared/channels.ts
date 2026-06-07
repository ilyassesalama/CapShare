/** IPC channel names — single source of truth for main, preload, and renderer. */
export const IPC = {
  /** invoke: renderer announces it can receive events; returns a pending .capshare path if any. */
  rendererReady: 'app:renderer-ready',
  /** event main→renderer: OS asked us to open a .capshare file. */
  openFile: 'app:open-file',
  /** event main→renderer: progress for a long-running task. */
  progress: 'task:progress',

  listProjects: 'projects:list',
  refreshProjects: 'projects:refresh',

  pickExportDestination: 'export:pick-destination',
  runExport: 'export:run',

  pickImportFile: 'import:pick-file',
  inspectImport: 'import:inspect',
  runImport: 'import:run',

  cancelTask: 'task:cancel',

  getSettings: 'settings:get',
  setSettings: 'settings:set',

  revealPath: 'app:reveal-path',
  launchCapCut: 'app:launch-capcut',
  isCapCutRunning: 'app:is-capcut-running',
  pickFolder: 'app:pick-folder'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
