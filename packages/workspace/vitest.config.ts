import { defineConfig } from 'vitest/config'
import { defaultClientConditions } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
    conditions: [...defaultClientConditions, 'dramai-source'],
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    css: false,
    // With FAKE_SERVER_DELAY_MS every request is slow on purpose, so a test needs more than the default 5 s
    testTimeout: process.env.FAKE_SERVER_DELAY_MS ? 30_000 : 5_000,
  },
})
