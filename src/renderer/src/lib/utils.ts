import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Frosted dismiss button overlaid on cover images and dialog corners. */
export const closeButtonClass =
  'size-7 rounded-full bg-black/40 text-white backdrop-blur-sm hover:bg-black/55 hover:text-white'
