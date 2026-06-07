import type { CapShareApi } from './index'

declare global {
  interface Window {
    capshare: CapShareApi
  }
}

export {}
