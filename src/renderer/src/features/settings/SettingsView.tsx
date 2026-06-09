import type { JSX, ReactNode } from 'react'
import { FolderOpen, RefreshCw, RotateCcw } from 'lucide-react'
import { Button, Label, ListBox, Select, Switch, toast } from '@heroui/react'
import type { AppSettings, UpdateStatus } from '@shared/types'
import type { UpdatesController } from '@/hooks/use-updates'
import { errorMessage, unwrap } from '@/lib/ipc'

const THEME_OPTIONS: { value: AppSettings['theme']; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

interface SettingsViewProps {
  settings: AppSettings | null
  onChange: (update: Partial<AppSettings>) => void
  updates: UpdatesController
}

/** Status line shown under the version row. */
function updateHelp(status: UpdateStatus, version: string): string {
  switch (status.state) {
    case 'checking':
      return 'Checking for updates…'
    case 'available':
      return `Downloading update ${status.version}…`
    case 'downloading':
      return `Downloading update… ${status.percent}%`
    case 'downloaded':
      return `Update ${status.version} ready — restart to install`
    case 'not-available':
      return `CapShare ${version} · up to date`
    case 'error':
      return status.message
    default:
      return version ? `CapShare ${version}` : 'CapShare'
  }
}

export function SettingsView({ settings, onChange, updates }: SettingsViewProps): JSX.Element {
  if (!settings) return <div />

  const pickFolder = async (
    title: string,
    key: 'draftRootOverride' | 'defaultExportDir'
  ): Promise<void> => {
    try {
      const folder = unwrap(await window.capshare.pickFolder(title))
      if (folder) onChange({ [key]: folder })
    } catch (error) {
      toast.danger(errorMessage(error))
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="app-drag px-6 pt-5 pb-3">
        <h1 className="text-xl font-bold tracking-tight">Settings</h1>
        <p className="text-[12px] text-muted-foreground">How CapShare finds and moves projects</p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-6 pt-4 pb-8">
        <SettingsGroup title="Locations">
          <SettingRow
            label="CapCut project folder"
            help={settings.draftRootOverride ?? 'Detected automatically'}
          >
            <div className="flex gap-1.5">
              {settings.draftRootOverride && (
                <Button
                  variant="ghost"
                  isIconOnly
                  className="rounded-full"
                  aria-label="Reset to automatic detection"
                  onPress={() => onChange({ draftRootOverride: null })}
                >
                  <RotateCcw className="size-4" />
                </Button>
              )}
              <Button
                variant="secondary"
                className="rounded-full border border-input"
                onPress={() =>
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
                  isIconOnly
                  className="rounded-full"
                  aria-label="Reset export location"
                  onPress={() => onChange({ defaultExportDir: null })}
                >
                  <RotateCcw className="size-4" />
                </Button>
              )}
              <Button
                variant="secondary"
                className="rounded-full border border-input"
                onPress={() => void pickFolder('Choose export folder', 'defaultExportDir')}
              >
                <FolderOpen className="size-4" /> Choose…
              </Button>
            </div>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup title="Sharing">
          <SettingRow
            label="Include AI caches by default"
            help="Larger .capshare files; skips re-analysis after import"
          >
            <Switch
              aria-label="Include AI caches by default"
              isSelected={settings.includeCachesByDefault}
              onChange={(checked) => onChange({ includeCachesByDefault: checked })}
            >
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup title="Appearance">
          <SettingRow label="Theme" help="Liquid glass follows your system by default">
            <Select
              aria-label="Theme"
              className="w-32"
              value={settings.theme}
              onChange={(theme) => onChange({ theme: theme as AppSettings['theme'] })}
            >
              <Select.Trigger className="rounded-full">
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {THEME_OPTIONS.map(({ value, label }) => (
                    <ListBox.Item key={value} id={value} textValue={label}>
                      {label}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup title="About">
          <SettingRow label="Version" help={updateHelp(updates.status, updates.version)}>
            {updates.status.state === 'downloaded' ? (
              <Button className="rounded-full" onPress={updates.install}>
                <RotateCcw className="size-4" /> Restart to update
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="rounded-full border border-input"
                isDisabled={updates.busy}
                onPress={updates.check}
              >
                <RefreshCw className={`size-4 ${updates.busy ? 'animate-spin' : ''}`} />
                Check for updates
              </Button>
            )}
          </SettingRow>
        </SettingsGroup>
      </div>
    </div>
  )
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-[15px] font-semibold tracking-tight">{title}</h2>
      <div className="glass-subtle divide-y divide-border/50 rounded-2xl px-4">{children}</div>
    </section>
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
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <Label className="text-[13px] font-medium">{label}</Label>
        <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground" title={help}>
          {help}
        </p>
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  )
}
