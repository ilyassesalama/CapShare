import type { JSX } from 'react'
import { FolderOpen, Import, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isMacLike } from '@/lib/format'

export type View = 'projects' | 'import' | 'settings'

const NAV: { view: View; label: string; icon: typeof FolderOpen }[] = [
  { view: 'projects', label: 'Projects', icon: FolderOpen },
  { view: 'import', label: 'Import', icon: Import },
  { view: 'settings', label: 'Settings', icon: Settings }
]

interface SidebarProps {
  view: View
  onNavigate: (view: View) => void
}

/** Floating Tahoe-style glass sidebar (navigation layer). */
export function Sidebar({ view, onNavigate }: SidebarProps): JSX.Element {
  return (
    <aside
      className={cn(
        'app-drag flex w-56 shrink-0 flex-col gap-1 px-3 pb-4',
        // Leave room for traffic lights on mac; title strip handles windows.
        isMacLike ? 'pt-14' : 'pt-4'
      )}
    >
      <div className="mb-4 flex items-center gap-2.5 px-2">
        <div className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#4F7DF9] via-[#6A5CF6] to-[#9D4DF0] text-sm font-bold text-white shadow-md">
          C
        </div>
        <div className="text-[15px] font-semibold tracking-tight">CapShare</div>
      </div>

      <nav className="app-no-drag flex flex-col gap-1">
        {NAV.map(({ view: itemView, label, icon: Icon }) => (
          <button
            key={itemView}
            onClick={() => onNavigate(itemView)}
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-all duration-150',
              view === itemView
                ? 'glass-subtle text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
            )}
          >
            <Icon className="size-4" strokeWidth={2.2} />
            {label}
          </button>
        ))}
      </nav>
    </aside>
  )
}
