import { useCallback, useEffect, useState, type JSX } from 'react'
import { toast, Toaster } from 'sonner'
import type { AppSettings, ProjectsResponse } from '@shared/types'
import { Sidebar, type View } from '@/components/Sidebar'
import { Wallpaper } from '@/components/glass/Wallpaper'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ImportView } from '@/features/import/ImportView'
import { ProjectsView } from '@/features/projects/ProjectsView'
import { SettingsView } from '@/features/settings/SettingsView'
import { errorMessage, unwrap } from '@/lib/ipc'

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

  useTheme(settings?.theme)

  const refreshProjects = useCallback(async (): Promise<void> => {
    setLoadingProjects(true)
    try {
      const response = unwrap(await window.capshare.listProjects())
      setProjects(response)
      for (const warning of response.warnings) toast.warning(warning)
    } catch (error) {
      toast.error(errorMessage(error))
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
        toast.error(errorMessage(error))
      }
    },
    [refreshProjects]
  )

  // Boot: load settings + projects, announce readiness, accept open-file events.
  useEffect(() => {
    let disposed = false
    const boot = async (): Promise<void> => {
      try {
        const loaded = unwrap(await window.capshare.getSettings())
        if (!disposed) setSettings(loaded)
      } catch {
        // Defaults apply.
      }
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
      toast.error(errorMessage(error))
    }
  }, [updateSettings])

  return (
    <TooltipProvider delayDuration={250}>
      <Wallpaper />
      <div className="flex h-full">
        <Sidebar view={view} onNavigate={setView} />
        <main className="min-w-0 flex-1 py-3 pr-3">
          <div className="glass relative h-full overflow-hidden rounded-3xl">
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
              <SettingsView settings={settings} onChange={(u) => void updateSettings(u)} />
            )}
          </div>
        </main>
      </div>
      <Toaster position="bottom-right" richColors closeButton />
    </TooltipProvider>
  )
}

export default App
