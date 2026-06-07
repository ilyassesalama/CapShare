import type { JSX } from 'react'
import { FolderOpen, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import type { AppSettings } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { errorMessage, unwrap } from '@/lib/ipc'

interface SettingsViewProps {
  settings: AppSettings | null
  onChange: (update: Partial<AppSettings>) => void
}

export function SettingsView({ settings, onChange }: SettingsViewProps): JSX.Element {
  if (!settings) return <div />

  const pickFolder = async (
    title: string,
    key: 'draftRootOverride' | 'defaultExportDir'
  ): Promise<void> => {
    try {
      const folder = unwrap(await window.capshare.pickFolder(title))
      if (folder) onChange({ [key]: folder })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="app-drag px-6 pt-5 pb-3">
        <h1 className="text-xl font-bold tracking-tight">Settings</h1>
        <p className="text-[12px] text-muted-foreground">How CapShare finds and moves projects</p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pb-6">
        <section className="glass-subtle flex flex-col gap-4 rounded-2xl p-4">
          <SettingRow
            label="CapCut project folder"
            help={settings.draftRootOverride ?? 'Detected automatically'}
          >
            <div className="flex gap-1.5">
              {settings.draftRootOverride && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                  aria-label="Reset to automatic detection"
                  onClick={() => onChange({ draftRootOverride: null })}
                >
                  <RotateCcw className="size-4" />
                </Button>
              )}
              <Button
                variant="secondary"
                className="rounded-full"
                onClick={() =>
                  void pickFolder('Choose the com.lveditor.draft folder', 'draftRootOverride')
                }
              >
                <FolderOpen className="size-4" /> Choose…
              </Button>
            </div>
          </SettingRow>

          <SettingRow
            label="Default export location"
            help={settings.defaultExportDir ?? 'Downloads'}
          >
            <div className="flex gap-1.5">
              {settings.defaultExportDir && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                  aria-label="Reset export location"
                  onClick={() => onChange({ defaultExportDir: null })}
                >
                  <RotateCcw className="size-4" />
                </Button>
              )}
              <Button
                variant="secondary"
                className="rounded-full"
                onClick={() => void pickFolder('Choose export folder', 'defaultExportDir')}
              >
                <FolderOpen className="size-4" /> Choose…
              </Button>
            </div>
          </SettingRow>
        </section>

        <section className="glass-subtle flex flex-col gap-4 rounded-2xl p-4">
          <SettingRow
            label="Include AI caches by default"
            help="Larger .capshare files; skips re-analysis after import"
          >
            <Switch
              checked={settings.includeCachesByDefault}
              onCheckedChange={(checked) => onChange({ includeCachesByDefault: checked })}
            />
          </SettingRow>

          <SettingRow label="Appearance" help="Liquid glass follows your system by default">
            <Select
              value={settings.theme}
              onValueChange={(theme) => onChange({ theme: theme as AppSettings['theme'] })}
            >
              <SelectTrigger className="w-32 rounded-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">System</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        </section>
      </div>
    </div>
  )
}

function SettingRow({
  label,
  help,
  children
}: {
  label: string
  help: string
  children: JSX.Element
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="min-w-0">
        <Label className="text-[13px] font-medium">{label}</Label>
        <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground" title={help}>
          {help}
        </p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
