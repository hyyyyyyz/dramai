import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useQueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactReport } from '@dramai/api'
import { Route, Routes } from 'react-router'
import { useDesktopNotifications } from '@/desktop/use-desktop-notifications'
import { jobTransitions } from '@/desktop/notifications'
import type { DesktopBridge } from '@/desktop/bridge'
import { ExportPage } from '@/features/export/ExportPage'
import { AccessPage } from '@/features/settings/AccessPage'
import { GeneralPage } from '@/features/settings/GeneralPage'
import { setLocale } from '@/i18n'
import { fakeServer, makeJob, makeSystem } from './fixtures'
import { makeTimeline } from './fixtures-compose'
import { makeEpisodeDetail, makeShot } from './fixtures-production'
import { renderApp, useLocale } from './render'

const bridge = (over: Partial<DesktopBridge> = {}): DesktopBridge => ({
  getInfo: vi.fn(async () => ({
    version: '0.5.0',
    platform: 'darwin' as const,
    arch: 'arm64',
    dataDir: '/data',
    secretStorage: 'os' as const,
    language: 'zh-CN' as const,
    languagePreference: 'auto' as const,
  })),
  selectFolder: vi.fn(async () => null),
  revealProjectFile: vi.fn(async () => true),
  notify: vi.fn(async () => true),
  setLanguage: vi.fn(async () => true),
  ...over,
})

const memoryStorage = () => {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  }
}

beforeEach(async () => {
  // Node 25 的 localStorage 在 vitest 里不完整，换成内存实现
  vi.stubGlobal('localStorage', memoryStorage())
  await useLocale('zh-CN')
})
afterEach(() => {
  delete window.dramaiDesktop
  vi.unstubAllGlobals()
})

describe('job transitions worth a notification', () => {
  const map = (e: [string, 'queued' | 'running' | 'succeeded']) => new Map([e])
  it('only jobs that were in flight and just finished; first-seen finished jobs are history', () => {
    const done = makeJob({ id: 'a', status: 'succeeded' })
    const bad = makeJob({ id: 'b', status: 'failed', needsAttention: true })
    const acked = makeJob({ id: 'c', status: 'failed', needsAttention: false })
    const prev = new Map<string, 'queued' | 'running'>([
      ['a', 'running'],
      ['b', 'queued'],
      ['c', 'running'],
    ])
    const t = jobTransitions(prev, [done, bad, acked, makeJob({ id: 'd', status: 'succeeded' })])
    expect(t.done.map((j) => j.id)).toEqual(['a'])
    expect(t.attention.map((j) => j.id)).toEqual(['b'])
    expect(jobTransitions(map(['a', 'succeeded']), [done]).done).toEqual([])
  })
  it('a result the user chose to ignore is not announced as a success', () => {
    const prev = new Map<string, 'running'>([['a', 'running']])
    expect(
      jobTransitions(prev, [makeJob({ id: 'a', status: 'succeeded', resultIgnored: true })]).done,
    ).toEqual([])
  })
})

describe('language reaches the desktop shell', () => {
  it('switching language tells the bridge, and works without one', async () => {
    const b = bridge()
    window.dramaiDesktop = b
    await setLocale('zh-TW')
    expect(b.setLanguage).toHaveBeenCalledWith('zh-TW')
    delete window.dramaiDesktop
    await expect(setLocale('zh-CN')).resolves.toBeUndefined()
  })

  it('a bridge that throws never breaks the language switch', async () => {
    window.dramaiDesktop = bridge({
      setLanguage: vi.fn(async () => {
        throw new Error('ipc')
      }),
    })
    await expect(setLocale('en')).resolves.toBeUndefined()
    await setLocale('zh-CN')
  })
})

const file = { path: 'exports/cut.mp4', mime: 'video/mp4', bytes: 5_000_000, sha256: 'x' }
const cutReport: ArtifactReport = {
  key: 'cut:ep_1',
  kind: 'cut',
  status: 'current',
  changes: [],
  staleUpstream: [],
  file,
}

function exportPage() {
  const server = fakeServer({
    'GET /api/episodes/ep_1': () => makeEpisodeDetail([makeShot({ id: 'a' })]),
    'GET /api/episodes/ep_1/artifacts': () => ({ items: [cutReport] }),
    'GET /api/episodes/ep_1/timeline': () => makeTimeline(),
    'GET /api/system': () => makeSystem(),
  })
  renderApp(
    <Routes>
      <Route path="/projects/:projectId/episodes/:episodeId/export" element={<ExportPage />} />
    </Routes>,
    { client: server.client, route: '/projects/proj_1/episodes/ep_1/export' },
  )
}

describe('show in folder', () => {
  it('in the desktop app the cut can be shown in the file manager', async () => {
    const b = bridge()
    window.dramaiDesktop = b
    exportPage()
    await userEvent.click(await screen.findByRole('button', { name: '在文件夹中显示' }))
    expect(b.revealProjectFile).toHaveBeenCalledWith({
      projectId: 'proj_1',
      path: 'exports/cut.mp4',
    })
  })

  it('says so when the file is gone', async () => {
    window.dramaiDesktop = bridge({ revealProjectFile: vi.fn(async () => false) })
    exportPage()
    await userEvent.click(await screen.findByRole('button', { name: '在文件夹中显示' }))
    expect(await screen.findByText('找不到这个文件，它可能已被移走')).toBeInTheDocument()
  })

  it('in a browser there is no such button, and the download is still there', async () => {
    exportPage()
    const row = (await screen.findByRole('heading', { name: '成片 mp4' })).closest('li')!
    expect(within(row).getByRole('link', { name: /下载/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '在文件夹中显示' })).toBeNull()
  })
})

describe('settings in the desktop app', () => {
  const settings = { activeProviders: {}, cost: {} }
  it('notifications can be switched off, and the switch exists only in the desktop app', async () => {
    window.dramaiDesktop = bridge()
    const server = fakeServer({ 'GET /api/settings': () => settings })
    const { unmount } = renderApp(<GeneralPage />, { client: server.client })
    const sw = await screen.findByRole('switch', { name: '任务完成或需要处理时通知我' })
    expect(sw).toBeChecked()
    await userEvent.click(sw)
    expect(localStorage.getItem('dramai.desktop.notify')).toBe('0')
    unmount()
    delete window.dramaiDesktop
    renderApp(<GeneralPage />, {
      client: fakeServer({ 'GET /api/settings': () => settings }).client,
    })
    await screen.findByRole('heading', { name: '界面语言' })
    expect(screen.queryByRole('switch', { name: '任务完成或需要处理时通知我' })).toBeNull()
  })

  it('warns when API keys are not encrypted by the system', async () => {
    window.dramaiDesktop = bridge({
      getInfo: vi.fn(async () => ({
        version: '1',
        platform: 'linux' as const,
        arch: 'x64',
        dataDir: '/d',
        secretStorage: 'plain' as const,
        language: 'en' as const,
        languagePreference: 'auto' as const,
      })),
    })
    const server = fakeServer({ 'GET /api/system': () => makeSystem() })
    renderApp(<AccessPage />, { client: server.client })
    expect(await screen.findByText(/没有被系统加密/)).toBeInTheDocument()
  })
})

function Watcher() {
  useDesktopNotifications()
  const qc = useQueryClient()
  return (
    <button
      onClick={() =>
        qc.setQueryData(['jobs'], {
          items: [
            makeJob({ id: 'j1', status: 'succeeded', operation: 'shot_video' }),
            makeJob({ id: 'j2', status: 'succeeded', operation: 'shot_video' }),
          ],
        })
      }
    >
      finish
    </button>
  )
}

describe('system notifications for finished tasks', () => {
  const running = () => [
    makeJob({ id: 'j1', status: 'running', operation: 'shot_video' }),
    makeJob({ id: 'j2', status: 'running', operation: 'shot_video' }),
  ]
  it('tasks that end together become one notification; a browser sends none', async () => {
    const b = bridge()
    window.dramaiDesktop = b
    const server = fakeServer({ 'GET /api/jobs': () => ({ items: running() }) })
    renderApp(<Watcher />, { client: server.client })
    const btn = await screen.findByRole('button', { name: 'finish' })
    await waitFor(() => expect(server.calls.some((c) => c.path === '/api/jobs')).toBe(true))
    await new Promise((r) => setTimeout(r, 50))
    await userEvent.click(btn)
    await waitFor(() => expect(b.notify).toHaveBeenCalledTimes(1), { timeout: 4000 })
    expect(b.notify).toHaveBeenCalledWith({ title: '2 个任务已完成', body: undefined })
  })

  it('stays quiet when the user turned notifications off', async () => {
    localStorage.setItem('dramai.desktop.notify', '0')
    const b = bridge()
    window.dramaiDesktop = b
    const server = fakeServer({ 'GET /api/jobs': () => ({ items: running() }) })
    renderApp(<Watcher />, { client: server.client })
    const btn = await screen.findByRole('button', { name: 'finish' })
    await new Promise((r) => setTimeout(r, 100))
    await userEvent.click(btn)
    await new Promise((r) => setTimeout(r, 2200))
    expect(b.notify).not.toHaveBeenCalled()
  })

  it('does nothing without the bridge', async () => {
    const server = fakeServer({ 'GET /api/jobs': () => ({ items: running() }) })
    renderApp(<Watcher />, { client: server.client })
    const btn = await screen.findByRole('button', { name: 'finish' })
    await userEvent.click(btn)
    await new Promise((r) => setTimeout(r, 1800))
    expect(server.calls.filter((c) => c.path === '/api/jobs').length).toBeGreaterThan(0)
  })
})
