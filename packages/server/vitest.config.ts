import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { conditions: ['dramai-source'] },
  ssr: { resolve: { conditions: ['dramai-source'] } },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Nearly every test here is an integration test: it starts a real server (SQLite, a lock file, an ffmpeg probe)
    // and reads and writes real files. Starting a server takes about 30 ms on a developer machine but, judging by
    // how long the Windows CI runner took for files of two or three tests, about 2-3 s there. So a test that starts
    // two of them and then cleans up (test/harness.test.ts) ran past vitest's default 5 s. The limits below are
    // headroom for slow runners, not a cover for hangs: the waits in the harness and the server's shutdown are
    // bounded by their own retries and deadlines. A test that sets its own timeout keeps it.
    testTimeout: 30_000,
    // beforeAll / afterEach start and stop servers and delete their data directories (retrying on Windows).
    hookTimeout: 60_000,
    server: { deps: { inline: [/@dramai\//] } },
  },
})
