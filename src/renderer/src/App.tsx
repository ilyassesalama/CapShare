import { useCallback, useEffect, useState, type JSX } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { Button, Toast, toast } from '@heroui/react'
import { RefreshCw } from 'lucide-react'
import type { AppSettings, ProjectsResponse } from '@shared/types'
import { Sidebar, type View } from '@/components/Sidebar'
import { Wallpaper } from '@/components/glass/Wallpaper'
import { ProgressiveBlur } from '@/components/glass/ProgressiveBlur'
import { ImportView } from '@/features/import/ImportView'
import { ProjectsView } from '@/features/projects/ProjectsView'
import { SettingsView } from '@/features/settings/SettingsView'
import { useUpdates } from '@/hooks/use-updates'
import { errorMessage, unwrap } from '@/lib/ipc'
import { cn } from '@/lib/utils'

const HEADERS: Record<View, { title: string; subtitle: string }> = {
  projects: { title: 'Projects', subtitle: 'CapCut library' },
  import: { title: 'Import', subtitle: "Bring a .capshare project into this machine's CapCut" },
  settings: { title: 'Settings', subtitle: 'How CapShare finds and moves projects' }
}
function useTheme(theme: AppSettings['theme'] | undefined): void {
  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = theme === 'dark' || ((theme ?? 'system') === 'system' && media.matches)
      root.classList.toggle('dark', dark)
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
}

function App(): JSX.Element {
  const [view, setView] = useState<View>('projects')
  const [projects, setProjects] = useState<ProjectsResponse | null>(null)
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [externalFile, setExternalFile] = useState<string | null>(null)
  const updates = useUpdates()

  useTheme(settings?.theme)

  const refreshProjects = useCallback(async (): Promise<void> => {
    setLoadingProjects(true)
    try {
      const response = unwrap(await window.capshare.listProjects())
      setProjects(response)
      for (const warning of response.warnings) toast.warning(warning)
    } catch (error) {
      toast.danger(errorMessage(error))
    } finally {
      setLoadingProjects(false)
    }
  }, [])

  const updateSettings = useCallback(
    async (update: Partial<AppSettings>): Promise<void> => {
      try {
        const next = unwrap(await window.capshare.setSettings(update))
        setSettings(next)
        if ('draftRootOverride' in update) void refreshProjects()
      } catch (error) {
        toast.danger(errorMessage(error))
      }
    },
    [refreshProjects]
  )

  useEffect(() => {
    let disposed = false
    const boot = async (): Promise<void> => {
      try {
        const loaded = unwrap(await window.capshare.getSettings())
        if (!disposed) setSettings(loaded)
      } catch {}
      await refreshProjects()
      const pending = await window.capshare.rendererReady()
      if (pending && !disposed) {
        setView('import')
        setExternalFile(pending)
      }
    }
    void boot()

    const unsubscribe = window.capshare.onOpenFile((filePath) => {
      setView('import')
      setExternalFile(filePath)
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [refreshProjects])

  const pickDraftRoot = useCallback(async (): Promise<void> => {
    try {
      const folder = unwrap(
        await window.capshare.pickFolder('Choose the com.lveditor.draft folder')
      )
      if (folder) await updateSettings({ draftRootOverride: folder })
    } catch (error) {
      toast.danger(errorMessage(error))
    }
  }, [updateSettings])

  return (
    <MotionConfig reducedMotion="user">
      <Wallpaper />
      <div className="flex h-full">
        <Sidebar view={view} onNavigate={setView} />
        {/* No overflow clip: the ProgressiveBlur reaches left under the sidebar
            (-left-56) so the band has no seam at the main edge. The blur and
            header are persistent chrome — kept outside AnimatePresence so they
            don't fade on view switch; only the scrollable body animates. */}
        <main className="relative min-w-0 flex-1">
          <ProgressiveBlur position="top" className="-left-56 right-0 z-10 h-24" />
          <header className="app-drag absolute inset-x-0 top-0 z-20 flex items-center justify-between px-6 pt-5 pb-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight">{HEADERS[view].title}</h1>
              <p className="text-[12px] font-medium text-foreground/75">
                {view === 'projects' && projects?.found
                  ? `${projects.drafts.length} CapCut project${projects.drafts.length === 1 ? '' : 's'}`
                  : HEADERS[view].subtitle}
              </p>
            </div>
            {view === 'projects' && (
              <Button
                variant="ghost"
                isIconOnly
                className="app-no-drag rounded-full"
                onPress={() => void refreshProjects()}
                isDisabled={loadingProjects}
                aria-label="Refresh projects"
              >
                <RefreshCw className={cn('size-4', loadingProjects && 'animate-spin')} />
              </Button>
            )}
          </header>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={view}
              className="h-full"
              initial={{ opacity: 0, y: 8, scale: 0.995, filter: 'blur(10px)' }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -6, scale: 0.995, filter: 'blur(8px)' }}
              transition={{ type: 'spring', stiffness: 650, damping: 42, mass: 0.8 }}
            >
              {view === 'projects' && (
                <ProjectsView
                  projects={projects}
                  loading={loadingProjects}
                  onRefresh={() => void refreshProjects()}
                  onPickDraftRoot={() => void pickDraftRoot()}
                />
              )}
              {view === 'import' && (
                <ImportView
                  externalFile={externalFile}
                  onExternalFileConsumed={() => setExternalFile(null)}
                  onImported={() => void refreshProjects()}
                />
              )}
              {view === 'settings' && (
                <SettingsView
                  settings={settings}
                  onChange={(u) => void updateSettings(u)}
                  updates={updates}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <Toast.Provider placement="bottom end" />
    </MotionConfig>
  )
}

export default App
