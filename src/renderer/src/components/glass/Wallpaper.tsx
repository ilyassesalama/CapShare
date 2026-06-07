import type { JSX } from 'react'

/**
 * The refractable backdrop behind all glass surfaces. A soft mesh-gradient
 * "wallpaper" in the spirit of macOS 26 defaults — glass over flat gray reads
 * dead, so this always gives the blur something rich to sample.
 */
export function Wallpaper(): JSX.Element {
  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-background" />
      <div
        className="absolute -top-1/4 -left-1/4 h-[80%] w-[70%] rounded-full opacity-60 blur-3xl dark:opacity-50"
        style={{
          background: 'radial-gradient(closest-side, oklch(0.72 0.16 262), transparent 70%)'
        }}
      />
      <div
        className="absolute top-1/3 -right-1/4 h-[75%] w-[65%] rounded-full opacity-50 blur-3xl dark:opacity-45"
        style={{
          background: 'radial-gradient(closest-side, oklch(0.74 0.14 310), transparent 70%)'
        }}
      />
      <div
        className="absolute -bottom-1/3 left-1/4 h-[70%] w-[60%] rounded-full opacity-45 blur-3xl dark:opacity-35"
        style={{
          background: 'radial-gradient(closest-side, oklch(0.8 0.1 200), transparent 70%)'
        }}
      />
    </div>
  )
}
