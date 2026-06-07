import { useEffect, useState, type JSX } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle2, Clapperboard, FileDown, FolderOpen, X } from 'lucide-react'
import { toast } from 'sonner'
import type { DraftSummary, ExportResult } from '@shared/types'
import { MiniTimeline } from '@/components/MiniTimeline'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { formatBytes, formatDuration, newTaskId } from '@/lib/format'
import { errorMessage, unwrap } from '@/lib/ipc'

type ExportPhase =
  | { state: 'idle' }
  | { state: 'running'; taskId: string; ratio: number }
  | { state: 'done'; result: ExportResult }

interface ProjectDetailProps {
  project: DraftSummary | null
  /** Visibility is controlled separately from `project` so the project stays
      mounted while the dialog plays its close animation. */
  open: boolean
  onClose: () => void
}

export function ProjectDetail({ project, open, onClose }: ProjectDetailProps): JSX.Element {
  return (
    // Keying by project resets all export state when another project opens.
    <DetailDialog
      key={project?.folderPath ?? 'none'}
      project={project}
      open={open}
      onClose={onClose}
    />
  )
}

function DetailDialog({ project, open, onClose }: ProjectDetailProps): JSX.Element {
  const [includeCaches, setIncludeCaches] = useState(false)
  const [phase, setPhase] = useState<ExportPhase>({ state: 'idle' })

  useEffect(() => {
    return window.capshare.onProgress((event) => {
      setPhase((current) =>
        current.state === 'running' && current.taskId === event.taskId
          ? { ...current, ratio: event.ratio }
          : current
      )
    })
  }, [])

  const startExport = async (): Promise<void> => {
    if (!project) return
    try {
      const destination = unwrap(await window.capshare.pickExportDestination(project.name))
      if (!destination) return
      const taskId = newTaskId()
      setPhase({ state: 'running', taskId, ratio: 0 })
      const result = unwrap(
        await window.capshare.runExport({
          taskId,
          folderPath: project.folderPath,
          destinationPath: destination,
          includeCaches
        })
      )
      setPhase({ state: 'done', result })
      for (const warning of result.warnings) toast.warning(warning)
      toast.success(`Exported "${project.name}"`)
    } catch (error) {
      setPhase({ state: 'idle' })
      toast.error(errorMessage(error))
    }
  }

  const cancelExport = (): void => {
    if (phase.state === 'running') {
      void window.capshare.cancelTask(phase.taskId)
      setPhase({ state: 'idle' })
    }
  }

  const reveal = (path: string): void => {
    void window.capshare.revealPath(path)
  }

  const exporting = phase.state === 'running'

  return (
    <Dialog
      open={open && project !== null}
      onOpenChange={(nextOpen) => !nextOpen && !exporting && onClose()}
    >
      <DialogContent
        showCloseButton={false}
        className="glass-strong max-w-2xl gap-0 overflow-hidden rounded-3xl border-none p-0"
      >
        {project && (
          <>
            <div className="relative h-56 w-full overflow-hidden bg-foreground/[0.04]">
              {project.coverDataUrl ? (
                <img src={project.coverDataUrl} alt="" className="size-full object-cover" />
              ) : (
                <div className="flex size-full items-center justify-center text-muted-foreground/40">
                  <Clapperboard className="size-14" strokeWidth={1.2} />
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/60 to-transparent" />
              <DialogTitle className="absolute bottom-3 left-5 text-xl font-bold text-white drop-shadow">
                {project.name}
              </DialogTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => !exporting && onClose()}
                aria-label="Close"
                className="absolute top-3 right-3 size-7 rounded-full bg-black/40 text-white backdrop-blur-sm hover:bg-black/55 hover:text-white"
              >
                <X className="size-4" />
              </Button>
            </div>

            <div className="flex flex-col gap-5 p-5">
              <div className="flex flex-wrap gap-2">
                <StatChip label="Duration" value={formatDuration(project.durationUs)} />
                {project.canvas && (
                  <StatChip
                    label="Canvas"
                    value={`${project.canvas.width}×${project.canvas.height}`}
                  />
                )}
                {project.fps && <StatChip label="FPS" value={String(Math.round(project.fps))} />}
                <StatChip
                  label="Media"
                  value={String(
                    project.mediaCounts.video +
                      project.mediaCounts.audio +
                      project.mediaCounts.image
                  )}
                />
                <StatChip label="Size" value={formatBytes(project.sizeBytes)} />
                {project.capcutVersion && <StatChip label="CapCut" value={project.capcutVersion} />}
              </div>

              <MiniTimeline tracks={project.tracks} durationUs={project.durationUs} />

              <AnimatePresence mode="wait" initial={false}>
                {phase.state === 'done' ? (
                  <motion.div
                    key="done"
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                    className="glass-subtle flex items-center justify-between rounded-2xl p-4"
                  >
                    <div className="flex items-center gap-3">
                      <motion.span
                        initial={{ scale: 0.4, rotate: -30 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ type: 'spring', stiffness: 380, damping: 18, delay: 0.08 }}
                      >
                        <CheckCircle2 className="size-5 text-emerald-500" />
                      </motion.span>
                      <div>
                        <div className="text-[13px] font-semibold">Export complete</div>
                        <div className="text-[11.5px] text-muted-foreground">
                          {formatBytes(phase.result.sizeBytes)} · {phase.result.fileCount} files
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      className="rounded-full"
                      onClick={() => reveal(phase.result.capsharePath)}
                    >
                      <FolderOpen className="size-4" /> Reveal file
                    </Button>
                  </motion.div>
                ) : exporting ? (
                  <motion.div
                    key="running"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                    className="glass-subtle flex flex-col gap-3 rounded-2xl p-4"
                  >
                    <div className="flex items-center justify-between text-[12.5px]">
                      <span className="font-medium">Exporting…</span>
                      <span className="text-muted-foreground tabular-nums">
                        {Math.round(phase.ratio * 100)}%
                      </span>
                    </div>
                    <Progress value={phase.ratio * 100} className="h-1.5" />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="self-end rounded-full text-muted-foreground"
                      onClick={cancelExport}
                    >
                      Cancel
                    </Button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="idle"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                    className="flex flex-col gap-4"
                  >
                    <div className="flex items-center gap-2.5">
                      <Switch
                        id="include-caches"
                        checked={includeCaches}
                        onCheckedChange={setIncludeCaches}
                      />
                      <div className="flex flex-col gap-0.5">
                        <Label
                          htmlFor="include-caches"
                          className="cursor-pointer text-[12px] leading-tight font-medium"
                        >
                          Include AI caches
                        </Label>
                        <span className="text-[10.5px] text-muted-foreground">
                          Bigger file; skips re-analysis on the other machine
                        </span>
                      </div>
                    </div>
                    <Button onClick={() => void startExport()} className="mt-2 w-full rounded-full">
                      <FileDown className="size-4" /> Export .capshare
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function StatChip({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="glass-subtle flex items-baseline gap-1.5 rounded-full px-3 py-1">
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className="text-[12px] font-semibold tabular-nums">{value}</span>
    </div>
  )
}
