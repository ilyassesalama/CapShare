import type { JSX } from 'react'
import { useState } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { isMacLike } from '@/lib/format'
import { Clapperboard } from '@/components/animate-ui/icons/clapperboard'
import { CloudDownload } from '@/components/animate-ui/icons/cloud-download'
import { Settings } from '@/components/animate-ui/icons/settings'
import logo from '@/assets/logo.png'

export type View = 'projects' | 'import' | 'settings'

type AnimatedIcon = typeof Clapperboard

const NAV: { view: View; label: string; icon: AnimatedIcon }[] = [
  { view: 'projects', label: 'Projects', icon: Clapperboard },
  { view: 'import', label: 'Import', icon: CloudDownload },
  { view: 'settings', label: 'Settings', icon: Settings }
]

interface SidebarProps {
  view: View
  onNavigate: (view: View) => void
}

interface NavItemProps {
  item: (typeof NAV)[number]
  active: boolean
  onSelect: () => void
}

/** Single nav button; animates its icon on hover and while active. */
function NavItem({ item: { label, icon: Icon }, active, onSelect }: NavItemProps): JSX.Element {
  const [hovered, setHovered] = useState(false)

  return (
    <motion.button
      onClick={onSelect}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      whileHover={{ scale: 1.015 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={cn(
        'relative flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] font-medium',
        active
          ? 'text-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active-pill"
          className="glass-subtle absolute inset-0 rounded-xl shadow-sm"
          transition={{ type: 'spring', stiffness: 480, damping: 36 }}
        />
      )}
      <Icon className="relative z-10" size={16} animate={hovered || active} />
      <span className="relative z-10">{label}</span>
    </motion.button>
  )
}

/** Floating Tahoe-style glass sidebar (navigation layer). */
export function Sidebar({ view, onNavigate }: SidebarProps): JSX.Element {
  return (
    <aside className="app-drag relative z-20 flex w-56 shrink-0 p-2">
      <div
        className={cn(
          'glass rounded-window-concentric flex w-full flex-col gap-1 overflow-hidden px-3 pb-4',
          // Leave room for traffic lights on mac; title strip handles windows.
          isMacLike ? 'pt-12' : 'pt-4'
        )}
      >
        <div className="mb-4 flex items-center gap-2.5 px-2">
          <img src={logo} alt="" draggable={false} className="size-8" />
          <div className="text-[15px] font-semibold tracking-tight">CapShare</div>
        </div>

        <nav className="app-no-drag flex flex-col gap-1">
          {NAV.map((item) => (
            <NavItem
              key={item.view}
              item={item}
              active={view === item.view}
              onSelect={() => onNavigate(item.view)}
            />
          ))}
        </nav>
      </div>
    </aside>
  )
}
