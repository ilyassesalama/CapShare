import { useCallback, useEffect, useState, type DragEvent, type JSX } from 'react'
import {
  AlertTriangle,
  Apple,
  AppWindow,
  CheckCircle2,
  Clapperboard,
  FileDown,
  FileUp,
  FolderOpen,
  Loader2,
  Rocket
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { AlertDialog, Button, ProgressBar, toast } from '@heroui/react'
import type { CollisionResolution, ImportPreview, ImportResult } from '@shared/types'
import { kinematicScale } from '@/lib/dialog-anim'
import { formatBytes, formatDate, formatDuration, newTaskId } from '@/lib/format'
import { errorMessage, unwrap } from '@/lib/ipc'
import { cn } from '@/lib/utils'

type ImportPhase =
  | { state: 'idle' }
  | { state: 'inspecting' }
  | { state: 'preview'; preview: ImportPreview }
  | { state: 'running'; taskId: string; ratio: number; preview: ImportPreview }
  | { state: 'done'; result: ImportResult }

interface ImportViewProps {
  /** A file the OS asked us to open (double-clicked .capshare), if any. */
  externalFile: string | null
  onExternalFileConsumed: () => void
  onImported: () => void
}

export function ImportView({
  externalFile,
  onExternalFileConsumed,
  onImported
}: ImportViewProps): JSX.Element {
  const [phase, setPhase] = useState<ImportPhase>({ state: 'idle' })
  const [dragging, setDragging] = useState(false)
  const [collisionOpen, setCollisionOpen] = useState(false)

  useEffect(() => {
    return window.capshare.onProgress((event) => {
      setPhase((current) =>
        current.state === 'running' && current.taskId === event.taskId
          ? { ...current, ratio: event.ratio }
          : current
      )
    })
  }, [])

  const inspect = useCallback(async (filePath: string): Promise<void> => {
    setPhase({ state: 'inspecting' })
    try {
      const preview = unwrap(await window.capshare.inspectImport(filePath))
      setPhase({ state: 'preview', preview })
    } catch (error) {
      setPhase({ state: 'idle' })
      toast.danger(errorMessage(error))
    }
  }, [])

  useEffect(() => {
    if (!externalFile) return
    onExternalFileConsumed()
    // No cleanup on purpose: consuming the file re-renders with externalFile
    // null, and a cleanup would cancel this timer before it ever fires.
    window.setTimeout(() => void inspect(externalFile), 0)
  }, [externalFile, inspect, onExternalFileConsumed])

  const browse = async (): Promise<void> => {
    try {
      const file = unwrap(await window.capshare.pickImportFile())
      if (file) await inspect(file)
    } catch (error) {
      toast.danger(errorMessage(error))
    }
  }

  const onDrop = (event: DragEvent): void => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (!file) return
    const path = window.capshare.getPathForFile(file)
    if (!path.toLowerCase().endsWith('.capshare')) {
      toast.danger('That is not a .capshare file.')
      return
    }
    void inspect(path)
  }

  const runImport = async (
    preview: ImportPreview,
    resolution?: CollisionResolution
  ): Promise<void> => {
    const taskId = newTaskId()
    setPhase({ state: 'running', taskId, ratio: 0, preview })
    try {
      const result = unwrap(
        await window.capshare.runImport({ taskId, filePath: preview.filePath, resolution })
      )
      setPhase({ state: 'done', result })
      for (const warning of result.warnings) toast.warning(warning, { timeout: 8000 })
      onImported()
    } catch (error) {
      setPhase({ state: 'preview', preview })
      toast.danger(errorMessage(error))
    }
  }

  const startImport = (): void => {
    if (phase.state !== 'preview') return
    if (phase.preview.collision) {
      setCollisionOpen(true)
    } else {
      void runImport(phase.preview)
    }
  }

  const launchCapCut = async (): Promise<void> => {
    const launched = unwrap(await window.capshare.launchCapCut())
    if (!launched) toast.danger('Could not find a CapCut installation to launch.')
  }

  return (
    <div className="flex h-full flex-col">
      <header className="app-drag px-6 pt-5 pb-3">
        <h1 className="text-xl font-bold tracking-tight">Import</h1>
        <p className="text-[12px] text-muted-foreground">
          Bring a .capshare project into this machine&apos;s CapCut
        </p>
      </header>

      <div className="flex min-h-0 flex-1 items-stretch justify-center overflow-y-auto px-6 pb-6">
        <AnimatePresence mode="wait" initial={false}>
          {phase.state === 'idle' && (
            <motion.button
              key="idle"
              initial={{ opacity: 0, scale: 0.99 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.99 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => void browse()}
              className={cn(
                'group relative flex w-full flex-col items-center justify-center gap-4 rounded-3xl transition-colors duration-200',
                dragging ? 'bg-primary/5' : 'hover:bg-foreground/2'
              )}
            >
              <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
                <rect
                  rx="23"
                  fill="none"
                  strokeWidth="2"
                  strokeDasharray="8 8"
                  style={{ x: 1, y: 1, width: 'calc(100% - 2px)', height: 'calc(100% - 2px)' }}
                  className={cn(
                    'transition-[stroke] duration-200',
                    dragging
                      ? 'drop-zone-dashes stroke-primary'
                      : 'stroke-border group-hover:stroke-primary/40'
                  )}
                />
              </svg>
              <motion.div
                animate={
                  dragging
                    ? { y: -4, scale: 1.04, rotate: [0, -4, 4, -3, 3, 0] }
                    : { y: 0, scale: 1, rotate: 0 }
                }
                transition={
                  dragging
                    ? {
                        y: { type: 'spring', stiffness: 320, damping: 22 },
                        scale: { type: 'spring', stiffness: 320, damping: 22 },
                        rotate: { duration: 0.9, ease: 'easeInOut', repeat: Infinity }
                      }
                    : { type: 'spring', stiffness: 320, damping: 22 }
                }
                className="glass flex size-20 items-center justify-center rounded-[28px]"
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={dragging ? 'drop' : 'idle'}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.6 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                  >
                    {dragging ? (
                      <FileDown className="size-9 text-primary" strokeWidth={1.7} />
                    ) : (
                      <FileUp className="size-9 text-primary" strokeWidth={1.7} />
                    )}
                  </motion.span>
                </AnimatePresence>
              </motion.div>
              <div className="text-center">
                <div className="text-[15px] font-semibold">
                  {dragging ? 'Drop to import' : 'Drop a .capshare file here'}
                </div>
                <div className="mt-1 text-[12px] text-muted-foreground">
                  or click to browse — double-clicking a .capshare file works too
                </div>
              </div>
            </motion.button>
          )}

          {phase.state === 'inspecting' && (
            <motion.div
              key="inspecting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center gap-3"
            >
              <Loader2 className="size-7 animate-spin text-primary" />
              <div className="text-[13px] text-muted-foreground">Reading project…</div>
            </motion.div>
          )}

          {(phase.state === 'preview' || phase.state === 'running') && (
            <PreviewCard
              key="preview"
              preview={phase.state === 'preview' ? phase.preview : phase.preview}
              running={phase.state === 'running'}
              ratio={phase.state === 'running' ? phase.ratio : 0}
              onImport={startImport}
              onDiscard={() => setPhase({ state: 'idle' })}
            />
          )}

          {phase.state === 'done' && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 300, damping: 24 }}
              className="flex flex-col items-center justify-center gap-4 text-center"
            >
              <div className="glass flex size-20 items-center justify-center rounded-[28px]">
                <CheckCircle2 className="size-9 text-emerald-500" strokeWidth={1.8} />
              </div>
              <div>
                <div className="text-[16px] font-semibold">“{phase.result.draftName}” imported</div>
                <p className="mt-1 max-w-sm text-[12.5px] text-muted-foreground">
                  Restart CapCut if it is open — the project will appear in your drafts list.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="rounded-full"
                  onPress={() => void window.capshare.revealPath(phase.result.folderPath)}
                >
                  <FolderOpen className="size-4" /> Reveal folder
                </Button>
                <Button className="rounded-full" onPress={() => void launchCapCut()}>
                  <Rocket className="size-4" /> Open CapCut
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full text-muted-foreground"
                onPress={() => setPhase({ state: 'idle' })}
              >
                Import another
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AlertDialog.Backdrop
        isOpen={collisionOpen}
        onOpenChange={setCollisionOpen}
        variant="blur"
        className={kinematicScale.backdrop}
        isDismissable
        isKeyboardDismissDisabled={false}
      >
        <AlertDialog.Container placement="center" size="sm" className={kinematicScale.container}>
          <AlertDialog.Dialog className="glass-strong rounded-3xl border-none">
            {({ close }) => (
              <>
                <AlertDialog.CloseTrigger className="top-3 right-3 size-7 rounded-full bg-black/40 text-white backdrop-blur-sm hover:bg-black/55 hover:text-white" />
                <AlertDialog.Header>
                  <AlertDialog.Icon status="warning" />
                  <AlertDialog.Heading>This project already exists</AlertDialog.Heading>
                </AlertDialog.Header>
                <AlertDialog.Body>
                  {phase.state === 'preview' && phase.preview.collision
                    ? `A project named “${phase.preview.collision.existingName}” is already in your CapCut library. Replacing it keeps a backup of the existing project.`
                    : ''}
                </AlertDialog.Body>
                <AlertDialog.Footer className="flex-row gap-2">
                  <Button
                    variant="danger"
                    className="flex-1 rounded-full"
                    onPress={() => {
                      if (phase.state === 'preview') void runImport(phase.preview, 'replace')
                      close()
                    }}
                  >
                    Replace existing
                  </Button>
                  <Button
                    className="flex-1 rounded-full"
                    onPress={() => {
                      if (phase.state === 'preview') void runImport(phase.preview, 'copy')
                      close()
                    }}
                  >
                    Import as a copy
                  </Button>
                </AlertDialog.Footer>
              </>
            )}
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  )
}

function PreviewCard({
  preview,
  running,
  ratio,
  onImport,
  onDiscard
}: {
  preview: ImportPreview
  running: boolean
  ratio: number
  onImport: () => void
  onDiscard: () => void
}): JSX.Element {
  const SourceIcon = preview.compat.sourceOs === 'mac' ? Apple : AppWindow
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      className="glass-strong my-auto w-full max-w-md overflow-hidden rounded-3xl"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-foreground/4">
        {preview.coverDataUrl ? (
          <img src={preview.coverDataUrl} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground/30">
            <Clapperboard className="size-14" strokeWidth={1.2} />
          </div>
        )}
        <div className="absolute inset-0 bg-linear-to-t from-black/75 via-black/10 to-transparent" />
        <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md">
          <SourceIcon className="size-3.5" />
          {preview.compat.sourceOs === 'mac' ? 'macOS' : 'Windows'}
          {preview.compat.sourceCapcutVersion && ` · ${preview.compat.sourceCapcutVersion}`}
        </span>
        <div className="absolute inset-x-0 bottom-0 p-4">
          <div className="text-[11px] font-semibold tracking-wide text-white/70 uppercase">
            Ready to import
          </div>
          <div className="truncate text-lg font-bold text-white drop-shadow">
            {preview.draftName}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap gap-2">
          <Stat label="Duration" value={formatDuration(preview.durationUs)} />
          {preview.canvas && (
            <Stat label="Canvas" value={`${preview.canvas.width}×${preview.canvas.height}`} />
          )}
          <Stat label="Media" value={String(preview.mediaCount)} />
          <Stat label="Size" value={formatBytes(preview.totalBytes)} />
          <Stat label="Exported" value={formatDate(Date.parse(preview.exportedAt) || null)} />
        </div>

        {preview.compat.warnings.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-2xl bg-amber-500/10 p-3">
            {preview.compat.warnings.map((warning, i) => (
              <div
                key={i}
                className="flex gap-2 text-[11.5px] leading-snug text-amber-700 dark:text-amber-400"
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {warning}
              </div>
            ))}
          </div>
        )}

        {running ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="font-medium">Importing…</span>
              <span className="text-muted-foreground tabular-nums">{Math.round(ratio * 100)}%</span>
            </div>
            <ProgressBar value={ratio * 100} aria-label="Import progress" className="w-full">
              <ProgressBar.Track className="h-1.5">
                <ProgressBar.Fill />
              </ProgressBar.Track>
            </ProgressBar>
          </div>
        ) : (
          <div className="flex gap-2 mt-4">
            <Button variant="ghost" className="flex-1 rounded-full" onPress={onDiscard}>
              Cancel
            </Button>
            <Button className="flex-1 rounded-full" onPress={onImport}>
              <FileUp className="size-4" /> Import project
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  )
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="glass-subtle flex items-baseline gap-1.5 rounded-full px-3 py-1">
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className="text-[12px] font-semibold tabular-nums">{value}</span>
    </div>
  )
}
