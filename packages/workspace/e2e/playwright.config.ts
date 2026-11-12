import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { MOCK_PORT, PORT } from './env'

/**
 * 端到端测试：在演示模式下走完整条路径（不花钱、结果可重复）。
 * 服务和界面由 Playwright 自己起：`pnpm demo` 用独立端口和一个临时数据目录，托管 `packages/workspace/dist`
 * （所以先 `vite build`，workspace 的 `e2e` 脚本已经包含了）。
 *
 * 浏览器：默认用 Playwright 自带的 chromium（CI 里先 `pnpm exec playwright install --with-deps chromium`）；
 * 本机想用已装的 Chrome：`PW_CHANNEL=chrome pnpm e2e`。
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const dist = path.resolve(here, '../dist')
const port = PORT
const mockPort = MOCK_PORT
const dataDir = mkdtempSync(path.join(tmpdir(), 'dramai-e2e-'))

export default defineConfig({
  testDir: here,
  testMatch: '*.spec.ts',
  globalSetup: './global-setup.ts',
  // 一个服务、一个数据目录：用例按文件顺序一个接一个跑，用例之间不共享项目，但共享服务进程
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: process.env.PW_CHANNEL || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    command: `pnpm demo --fresh --port ${port} --mock-port ${mockPort} --data-dir "${dataDir}" --static-dir "${dist}" --latency 30 --video-ms 600`,
    cwd: root,
    url: `http://127.0.0.1:${port}/api/system`,
    reuseExistingServer: false,
    timeout: 90_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
