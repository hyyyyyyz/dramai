import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { conditions: ['dramai-source'] },
  ssr: { resolve: { conditions: ['dramai-source'] } },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Every test of `run` here starts a real server (see packages/server/vitest.config.ts for
    // why that is slow on the Windows CI runner and why these limits are not hiding hangs). A test that sets its own
    // timeout keeps it.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    server: { deps: { inline: [/@dramai\//] } },
  },
})
