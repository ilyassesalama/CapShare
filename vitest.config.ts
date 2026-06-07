import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main')
    }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    /* Core tests touch real temp dirs; keep them isolated and serial per file. */
    pool: 'forks'
  }
})
