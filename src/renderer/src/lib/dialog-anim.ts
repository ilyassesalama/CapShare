/**
 * "Kinematic Scale" — physics-based elastic dialog transition (HeroUI custom
 * animation). Fast spring-in with a long settle, quick ease-out on close.
 *
 * Apply `.backdrop` to a HeroUI `*.Backdrop` and `.container` to its
 * `*.Container` — the Container is the element HeroUI zooms by default, so this
 * overrides it cleanly. Works for both `Modal` and `AlertDialog`.
 */
export const kinematicScale = {
  backdrop: [
    'data-[entering]:duration-400',
    'data-[entering]:ease-[cubic-bezier(0.16,1,0.3,1)]',
    'data-[exiting]:duration-200',
    'data-[exiting]:ease-[cubic-bezier(0.7,0,0.84,0)]'
  ].join(' '),
  container: [
    'data-[entering]:animate-in',
    'data-[entering]:fade-in-0',
    'data-[entering]:zoom-in-95',
    'data-[entering]:duration-400',
    'data-[entering]:ease-[cubic-bezier(0.16,1,0.3,1)]',
    'data-[exiting]:animate-out',
    'data-[exiting]:fade-out-0',
    'data-[exiting]:zoom-out-95',
    'data-[exiting]:duration-200',
    'data-[exiting]:ease-[cubic-bezier(0.7,0,0.84,0)]'
  ].join(' ')
} as const
