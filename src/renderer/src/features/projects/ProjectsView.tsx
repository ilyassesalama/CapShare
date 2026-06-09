import { useState, type JSX } from 'react'
import { FolderSearch, RefreshCw } from 'lucide-react'
import { Button, Skeleton } from '@heroui/react'
import type { DraftSummary, ProjectsResponse } from '@shared/types'
import { cn } from '@/lib/utils'
import { ProjectCard } from './ProjectCard'
import { ProjectDetail } from './ProjectDetail'

interface ProjectsViewProps {
  projects: ProjectsResponse | null
  loading: boolean
  onRefresh: () => void
  onPickDraftRoot: () => void
}

export function ProjectsView({
  projects,
  loading,
  onRefresh,
  onPickDraftRoot
}: ProjectsViewProps): JSX.Element {
  const [selected, setSelected] = useState<DraftSummary | null>(null)
  // `selected` survives close so the dialog can animate out with its content.
  const [detailOpen, setDetailOpen] = useState(false)

  const openDetail = (project: DraftSummary): void => {
    setSelected(project)
    setDetailOpen(true)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="app-drag flex items-center justify-between px-6 pt-5 pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Projects</h1>
          <p className="text-[12px] text-muted-foreground">
            {projects?.found
              ? `${projects.drafts.length} CapCut project${projects.drafts.length === 1 ? '' : 's'}`
              : 'CapCut library'}
          </p>
        </div>
        <Button
          variant="ghost"
          isIconOnly
          className="app-no-drag rounded-full"
          onPress={onRefresh}
          isDisabled={loading}
          aria-label="Refresh projects"
        >
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-6">
        {loading && !projects ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-2xl">
                <Skeleton className="aspect-video w-full" />
                <div className="space-y-2 p-3.5">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : !projects?.found ? (
          <EmptyState
            title="CapCut not found"
            body="CapShare couldn't locate a CapCut project folder on this machine. If CapCut is installed with a custom project location, point CapShare at it."
            action={
              <Button onPress={onPickDraftRoot} className="rounded-full">
                <FolderSearch className="size-4" /> Choose project folder…
              </Button>
            }
          />
        ) : projects.drafts.length === 0 ? (
          <EmptyState
            title="No projects yet"
            body="Projects you create in CapCut will appear here, ready to export as .capshare files."
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {projects.drafts.map((project, index) => (
              <ProjectCard
                key={project.draftId + project.folderPath}
                project={project}
                index={index}
                onOpen={openDetail}
              />
            ))}
          </div>
        )}
      </div>

      <ProjectDetail project={selected} open={detailOpen} onClose={() => setDetailOpen(false)} />
    </div>
  )
}

function EmptyState({
  title,
  body,
  action
}: {
  title: string
  body: string
  action?: JSX.Element
}): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="glass-subtle flex size-16 items-center justify-center rounded-3xl">
        <FolderSearch className="size-7 text-muted-foreground" strokeWidth={1.6} />
      </div>
      <div className="text-[15px] font-semibold">{title}</div>
      <p className="max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">{body}</p>
      {action}
    </div>
  )
}
