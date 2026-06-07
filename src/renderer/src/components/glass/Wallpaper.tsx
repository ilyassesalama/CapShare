import type { JSX } from 'react'

/**
 * The backdrop behind all glass surfaces.
 *
 * On macOS (vibrancy) and Windows 11 (acrylic) the OS already renders a
 * blurred, live view of whatever is behind the window — so the app only lays
 * a semi-transparent tint over it for contrast, and the UI adapts to the
 * user's desktop. On systems without native materials (Windows 10, Linux)
 * a painted gradient wallpaper stands in, since glass over a flat void
 * reads dead.
 */
export function Wallpaper(): JSX.Element {
  if (window.capshare.env.nativeMaterial) {
    return (
      <div aria-hidden className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-background/45 dark:bg-background/40" />
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-foreground/[0.04] to-transparent" />
      </div>
    )
  }

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
