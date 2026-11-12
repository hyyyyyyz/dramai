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
    // Must be larger than asyncUtilTimeout in tests/setup.ts: when a wait runs out, the failure should name the
    // assertion that did not hold, not a bare "Test timed out". With FAKE_SERVER_DELAY_MS every request is slow on
    // purpose, so a test gets more room still.
    testTimeout: process.env.FAKE_SERVER_DELAY_MS ? 30_000 : 15_000,
  },
})
