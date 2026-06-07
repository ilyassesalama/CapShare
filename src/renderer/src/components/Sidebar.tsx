import type { JSX } from 'react'
import { motion } from 'motion/react'
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
          <motion.button
            key={itemView}
            onClick={() => onNavigate(itemView)}
            whileHover={{ scale: 1.015 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className={cn(
              'relative flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] font-medium',
              view === itemView
                ? 'text-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
            )}
          >
            {view === itemView && (
              <motion.span
                layoutId="sidebar-active-pill"
                className="glass-subtle absolute inset-0 rounded-xl shadow-sm"
                transition={{ type: 'spring', stiffness: 480, damping: 36 }}
              />
            )}
            <Icon className="relative z-10 size-4" strokeWidth={2.2} />
            <span className="relative z-10">{label}</span>
          </motion.button>
        ))}
      </nav>
    </aside>
  )
}
