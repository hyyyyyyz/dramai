import { Route, Routes } from 'react-router'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ArtifactReport, ProjectListItem } from '@dramai/api'
import { ExportPage } from '@/features/export/ExportPage'
import { AboutPage } from '@/features/settings/AboutPage'
import { DataPage } from '@/features/settings/DataPage'
import { GeneralPage } from '@/features/settings/GeneralPage'
import { ProjectsPage } from '@/features/projects/ProjectsPage'
import { fakeServer, makeSystem } from './fixtures'
import { makeTimeline } from './fixtures-compose'
import { makeEpisodeDetail, makeShot } from './fixtures-production'
import { renderApp, useLocale } from './render'

beforeEach(async () => {
  await useLocale('zh-CN')
})

const file = (bytes: number) => ({ path: 'cut.mp4', mime: 'video/mp4', bytes, sha256: 'x' })
const report = (
  kind: ArtifactReport['kind'],
  status: ArtifactReport['status'],
  withFile = false,
): ArtifactReport => ({
  key: `${kind}:x`,
  kind,
  status,
  changes: [],
  staleUpstream: [],
  ...(withFile ? { file: file(20 * 1024 * 1024) } : {}),
})

function exportSetup(opts: { artifacts: ArtifactReport[]; blocking?: boolean }) {
  const timeline = makeTimeline({
    issues: opts.blocking ? [{ severity: 'blocking', code: 'VIDEO_MISSING', message: '' }] : [],
  })
  const server = fakeServer({
    'GET /api/episodes/ep_1': () => makeEpisodeDetail([makeShot({ id: 'shot_1' })]),
    'GET /api/episodes/ep_1/artifacts': () => ({ items: opts.artifacts }),
    'GET /api/episodes/ep_1/timeline': () => timeline,
    'GET /api/system': () => makeSystem(),
    'GET /api/projects/proj_1/episodes': () => ({ items: [] }),
  })
  renderApp(
    <Routes>
      <Route path="/projects/:projectId/episodes/:episodeId/export" element={<ExportPage />} />
    </Routes>,
    { client: server.client, route: '/projects/proj_1/episodes/ep_1/export' },
  )
  return server
}

describe('export page', () => {
  it('lists the cut as latest with a download link and its size', async () => {
    exportSetup({ artifacts: [report('cut', 'current', true), report('subtitles', 'current')] })
    const cutRow = (await screen.findByRole('heading', { name: '成片 mp4' })).closest('li')!
    expect(within(cutRow).getByText('最新')).toBeInTheDocument()
    expect(within(cutRow).getByText('20 MB')).toBeInTheDocument()
    expect(within(cutRow).getByRole('link', { name: /下载/ })).toHaveAttribute(
      'href',
      '/api/episodes/ep_1/export/cut',
    )
  })

  it('a stale cut says so, still downloads, and offers to render again', async () => {
    exportSetup({ artifacts: [report('cut', 'stale', true)] })
    const row = (await screen.findByRole('heading', { name: '成片 mp4' })).closest('li')!
    expect(within(row).getByText('已过期')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: /仍然下载/ })).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: /重新渲染/ })).toHaveAttribute(
      'href',
      '/projects/proj_1/episodes/ep_1/compose',
    )
  })

  it('no cut yet: marked missing, nothing to download', async () => {
    exportSetup({ artifacts: [] })
    const row = (await screen.findByRole('heading', { name: '成片 mp4' })).closest('li')!
    expect(within(row).getByText('缺失')).toBeInTheDocument()
    expect(within(row).queryByRole('link', { name: /下载/ })).toBeNull()
  })

  it('the package is blocked while the timeline has blocking issues, with the reason and a way to fix it', async () => {
    exportSetup({ artifacts: [report('cut', 'current', true)], blocking: true })
    const row = (await screen.findByRole('heading', { name: '素材包 zip' })).closest('li')!
    expect(await within(row).findByText('被拦下')).toBeInTheDocument()
    expect(within(row).getByText(/还有 1 个/)).toBeInTheDocument()
    expect(within(row).queryByRole('link', { name: /下载素材包/ })).toBeNull()
    expect(within(row).getByRole('link', { name: '去处理' })).toBeInTheDocument()
  })

  it('an unblocked package downloads with the chosen options in the address', async () => {
    exportSetup({ artifacts: [report('cut', 'current', true)] })
    const link = await screen.findByRole('link', { name: /下载素材包/ })
    expect(link).toHaveAttribute('href', '/api/episodes/ep_1/export/package?images=1&cut=0')
    await userEvent.click(screen.getByRole('checkbox', { name: '分镜图' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '渲染好的成片' }))
    expect(screen.getByRole('link', { name: /下载素材包/ })).toHaveAttribute(
      'href',
      '/api/episodes/ep_1/export/package?images=0&cut=1',
    )
  })
})

describe('settings · general', () => {
  const settings = { activeProviders: { llm: 'a' }, cost: {}, defaultSubtitles: 'soft' as const }
  it('saves the default subtitle mode as part of the whole settings object', async () => {
    const server = fakeServer({
      'GET /api/settings': () => settings,
      'PUT /api/settings': ({ body }) => body,
    })
    renderApp(<GeneralPage />, { client: server.client })
    await userEvent.click(await screen.findByRole('radio', { name: '不要字幕' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
        activeProviders: { llm: 'a' },
        defaultSubtitles: 'none',
      }),
    )
  })

  it('cost conversion stays off by default, validates rates, and saves a conversion', async () => {
    const server = fakeServer({
      'GET /api/settings': () => settings,
      'PUT /api/settings': ({ body }) => body,
    })
    renderApp(<GeneralPage />, { client: server.client })
    await userEvent.click(
      await screen.findByRole('switch', { name: '把不同币种的预估合成一个数字' }),
    )
    await userEvent.click(screen.getByRole('button', { name: '加一个币种' }))
    const save = screen.getByRole('button', { name: '保存' })
    expect(save).toBeDisabled()
    await userEvent.type(screen.getByLabelText('币种'), 'usd')
    await userEvent.type(screen.getByLabelText(/1 单位折合多少/), '7.2')
    expect(save).toBeEnabled()
    await userEvent.click(save)
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
        cost: { conversion: { targetCurrency: 'CNY', rates: { USD: 7.2 } } },
      }),
    )
  })
})

describe('settings · about', () => {
  it('shows the ffmpeg path and version, what is unavailable, and what is missing with its remedy', async () => {
    const server = fakeServer({
      'GET /api/system': () =>
        makeSystem({
          ffmpeg: {
            found: true,
            ok: true,
            path: '/opt/ffmpeg',
            version: '9.0',
            features: { h264: true, subtitleBurnIn: false },
            missing: [
              {
                feature: 'subtitleBurnIn',
                required: false,
                reason: '没有字幕滤镜',
                remedy: '换用带 libass 的构建',
              },
            ],
          },
        }),
    })
    renderApp(<AboutPage />, { client: server.client })
    expect(await screen.findByText('/opt/ffmpeg')).toBeInTheDocument()
    expect(screen.getByText('9.0')).toBeInTheDocument()
    expect(screen.getByText('换用带 libass 的构建')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'ffmpeg 能力' })
    expect(within(list).getByText('字幕烧进画面').closest('li')).toHaveTextContent('不可用')
  })
})

const proj = (patch: Partial<ProjectListItem> = {}): ProjectListItem => ({
  schemaVersion: 1,
  id: 'p1',
  name: '清朝宫廷',
  aspectRatio: '9:16',
  style: { source: 'none', label: '', description: '', imageKeywords: '', expandedAt: 1 },
  narrationDelivery: 'tts',
  episodeOrder: [],
  counters: { episode: 0, scene: 0, shot: 0, asset: 0, material: 0 },
  createdAt: 1,
  updatedAt: 1,
  episodes: [],
  shotCounts: { total: 0, withImage: 0, withVideo: 0, failed: 0 },
  thumbnails: [],
  ...patch,
})

describe('settings · data and backup', () => {
  it('imports a legacy backup as multipart and reports what came across and what did not', async () => {
    const server = fakeServer({
      'GET /api/system': () => makeSystem({ dataDir: '/data/dramai' }),
      'GET /api/projects': () => ({ items: [] }),
      'POST /api/import/legacy': () => ({
        projects: [
          {
            legacyId: 'old',
            projectId: 'p9',
            name: '旧项目',
            episodes: 2,
            shots: 10,
            assets: 3,
            materials: 1,
            images: 4,
            videos: 2,
            artifactsRegistered: 6,
            artifactsSkipped: 1,
          },
        ],
        skipped: [{ legacyId: 'old2', reason: '已经导入过' }],
        droppedGenerations: 5,
        droppedPendingVideoTasks: 1,
      }),
    })
    const { container } = renderApp(<DataPage />, { client: server.client })
    expect(await screen.findByText('/data/dramai')).toBeInTheDocument()
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    await userEvent.upload(input, new File(['{}'], 'backup.json', { type: 'application/json' }))
    expect(await screen.findByText('导入了 1 个项目')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '旧项目' })).toHaveAttribute('href', '/projects/p9')
    expect(screen.getByText(/没有带过来：5 条生成记录、1 个没做完的视频任务/)).toBeInTheDocument()
    expect(screen.getByText(/跳过 old2：已经导入过/)).toBeInTheDocument()
    expect(server.calls.some((c) => c.path === '/api/import/legacy')).toBe(true)
  })

  it('restores from the trash directly, and only purges after a second confirmation', async () => {
    const server = fakeServer({
      'GET /api/system': () => makeSystem(),
      'GET /api/projects': () => ({ items: [proj({ deletedAt: Date.now() - 60_000 })] }),
      'POST /api/projects/p1/restore': () => proj(),
      'DELETE /api/projects/p1/purge': () => ({ ok: true }),
    })
    renderApp(<DataPage />, { client: server.client })
    await userEvent.click(await screen.findByRole('button', { name: '彻底清除项目 清朝宫廷' }))
    expect(server.calls.some((c) => c.method === 'DELETE')).toBe(false)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/无法恢复/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: '彻底清除' }))
    await waitFor(() =>
      expect(
        server.calls.some((c) => c.method === 'DELETE' && c.path === '/api/projects/p1/purge'),
      ).toBe(true),
    )
  })

  it('restore needs no confirmation', async () => {
    const server = fakeServer({
      'GET /api/system': () => makeSystem(),
      'GET /api/projects': () => ({ items: [proj({ deletedAt: 5 })] }),
      'POST /api/projects/p1/restore': () => proj(),
    })
    renderApp(<DataPage />, { client: server.client })
    await userEvent.click(await screen.findByRole('button', { name: '恢复项目 清朝宫廷' }))
    await waitFor(() =>
      expect(server.calls.some((c) => c.path === '/api/projects/p1/restore')).toBe(true),
    )
  })
})

describe('projects page · delete', () => {
  it('delete goes through the card menu and a confirmation, and says it moves to the trash', async () => {
    const server = fakeServer({
      'GET /api/projects': () => ({ items: [proj()] }),
      'GET /api/system': () => makeSystem(),
      'DELETE /api/projects/p1': () => ({ ok: true }),
    })
    renderApp(<ProjectsPage />, { client: server.client })
    await userEvent.click(await screen.findByRole('button', { name: '项目 清朝宫廷 的更多操作' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /删除项目/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/先移到回收站/)).toBeInTheDocument()
    expect(server.calls.some((c) => c.method === 'DELETE')).toBe(false)
    await userEvent.click(within(dialog).getByRole('button', { name: '移到回收站' }))
    await waitFor(() =>
      expect(server.calls.some((c) => c.method === 'DELETE' && c.path === '/api/projects/p1')).toBe(
        true,
      ),
    )
  })
})
