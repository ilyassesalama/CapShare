import type { JSX } from 'react'

/** Pill showing one labeled project stat (duration, size, …) on detail cards. */
export function StatChip({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="glass-subtle flex items-baseline gap-1.5 rounded-full px-3 py-1">
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className="text-[12px] font-semibold tabular-nums">{value}</span>
    </div>
  )
}
