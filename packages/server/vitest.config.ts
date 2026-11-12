import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { conditions: ['dramai-source'] },
  ssr: { resolve: { conditions: ['dramai-source'] } },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    server: { deps: { inline: [/@dramai\//] } },
  },
})
