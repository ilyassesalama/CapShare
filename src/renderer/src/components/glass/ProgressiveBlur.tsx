import type { JSX } from 'react'
import { cn } from '@/lib/utils'

interface ProgressiveBlurProps {
  className?: string
  position?: 'top' | 'bottom'
  blurAmount?: string
  backgroundColor?: string
}

export function ProgressiveBlur({
  className,
  position = 'top',
  blurAmount = '4px',
  backgroundColor = 'color-mix(in oklab, var(--background) 85%, transparent)'
}: ProgressiveBlurProps): JSX.Element {
  const isTop = position === 'top'
  const mask = `linear-gradient(${isTop ? 'to bottom' : 'to top'}, black 50%, transparent)`

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute select-none',
        isTop ? 'top-0' : 'bottom-0',
        className
      )}
      style={{
        background: `linear-gradient(${isTop ? 'to top' : 'to bottom'}, transparent, ${backgroundColor})`,
        maskImage: mask,
        WebkitMaskImage: mask,
        backdropFilter: `blur(${blurAmount})`,
        WebkitBackdropFilter: `blur(${blurAmount})`
      }}
    />
  )
}
