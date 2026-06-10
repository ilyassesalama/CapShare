/**
 * Rounds the native NSWindow hosting the given content view while keeping
 * vibrancy intact. `handle` is `BrowserWindow.getNativeWindowHandle()`.
 * Radius 0 restores square corners. Returns false on failure / non-macOS.
 */
export function setCornerRadius(handle: Buffer, radius: number): boolean
