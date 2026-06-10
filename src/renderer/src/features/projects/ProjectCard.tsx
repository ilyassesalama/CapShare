import type { JSX } from 'react'
import { motion } from 'motion/react'
import { Clapperboard } from 'lucide-react'
import type { DraftSummary } from '@shared/types'
import { formatBytes, formatDate, formatDuration } from '@/lib/format'

interface ProjectCardProps {
  project: DraftSummary
  index: number
  onOpen: (project: DraftSummary) => void
  onContextMenu: (project: DraftSummary, x: number, y: number) => void
}

export function ProjectCard({
  project,
  index,
  onOpen,
  onContextMenu
}: ProjectCardProps): JSX.Element {
  return (
    <motion.button
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 350, damping: 28, delay: index * 0.04 }}
      onClick={() => onOpen(project)}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(project, e.clientX, e.clientY)
      }}
      className="glass group flex flex-col overflow-hidden rounded-2xl text-left shadow-sm outline-2 outline-transparent transition-[outline-color] hover:outline-primary/60"
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-t-2xl bg-foreground/4">
        {project.coverDataUrl ? (
          <img
            src={project.coverDataUrl}
            alt=""
            draggable={false}
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground/40">
            <Clapperboard className="size-10" strokeWidth={1.5} />
          </div>
        )}
        <div className="absolute right-2 bottom-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white tabular-nums backdrop-blur-sm">
          {formatDuration(project.durationUs)}
        </div>
      </div>
      <div className="flex flex-col gap-0.5 px-3.5 py-3">
        <div className="truncate text-[13px] font-semibold">{project.name}</div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{formatDate(project.modifiedAt)}</span>
          <span aria-hidden>·</span>
          <span>{formatBytes(project.sizeBytes)}</span>
        </div>
      </div>
    </motion.button>
  )
}
