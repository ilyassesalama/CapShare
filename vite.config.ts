/**
 * Tooling-detection shim — the app's real config is electron.vite.config.ts.
 * electron-vite ignores this file; it exists so tools that probe for a Vite
 * project at the repo root (e.g. the shadcn CLI's framework check) work.
 * Mirrors the renderer section of electron.vite.config.ts.
 */
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'src/renderer',
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  plugins: [react(), tailwindcss()]
})
