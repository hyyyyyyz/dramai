import { Route, Routes } from 'react-router'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { TimelineView } from '@dramai/api'
import { ComposePage } from '@/features/compose/ComposePage'
import { fakeServer, makeJob, makeSystem } from './fixtures'
import { makeTimeline, type Issue } from './fixtures-compose'
import { makeEpisodeDetail, makeShot, slotWith } from './fixtures-production'
import { renderApp, useLocale } from './render'

beforeEach(async () => {
  await useLocale('zh-CN')
})

const project = {
  schemaVersion: 1,
  id: 'proj_1',
  name: '清朝宫廷',
  aspectRatio: '9:16' as const,
  style: { source: 'none' as const, label: '', description: '', imageKeywords: '', expandedAt: 1 },
  narrationDelivery: 'tts' as const,
  episodeOrder: ['ep_1'],
  counters: { episode: 1, scene: 1, shot: 2, asset: 0, material: 0 },
  createdAt: 1,
  updatedAt: 1,
}

function setup(
  opts: {
    issues?: Issue[]
    timeline?: TimelineView
    routes?: Parameters<typeof fakeServer>[0]
    system?: ReturnType<typeof makeSystem>
    jobs?: ReturnType<typeof makeJob>[]
  } = {},
) {
  const shots = [
    makeShot({ id: 'shot_1', image: slotWith('image'), video: slotWith('video') }),
    makeShot({ id: 'shot_2', image: slotWith('image'), video: slotWith('video') }),
  ]
  const timeline = opts.timeline ?? makeTimeline({ issues: opts.issues })
  const server = fakeServer({
    'GET /api/projects/proj_1': () => project,
    'GET /api/episodes/ep_1': () => makeEpisodeDetail(shots),
    'GET /api/episodes/ep_1/timeline': () => timeline,
    'GET /api/episodes/ep_1/artifacts': () => ({ items: [] }),
    'GET /api/projects/proj_1/assets': () => ({ items: [] }),
    'GET /api/jobs': () => ({ items: opts.jobs ?? [] }),
    'GET /api/system': () => opts.system ?? makeSystem(),
    'GET /api/settings': () => ({ activeProviders: {}, cost: {} }),
    'PUT /api/episodes/ep_1/timeline': () => timeline,
    'POST /api/episodes/ep_1/timeline/rollback': () => timeline,
    'POST /api/episodes/ep_1/compose': () => ({
      job: makeJob({ type: 'render', operation: 'compose', episodeId: 'ep_1', paid: false }),
      deduped: false,
    }),
    ...opts.routes,
  })
  const view = renderApp(
    <Routes>
      <Route path="/projects/:projectId/episodes/:episodeId/compose" element={<ComposePage />} />
    </Routes>,
    { client: server.client, route: '/projects/proj_1/episodes/ep_1/compose' },
  )
  return { ...view, server }
}

const blocking: Issue = {
  severity: 'blocking',
  code: 'VIDEO_MISSING',
  clipId: 'clip_2',
  shotId: 'shot_2',
  message: 'raw server text',
}

describe('compose page', () => {
  it('lays out the timeline and says plainly what the backend does not do', async () => {
    setup()
    expect(await screen.findByRole('group', { name: '时间线' })).toBeInTheDocument()
    expect(screen.getByText(/转场目前只有硬切，配乐只支持一条/)).toBeInTheDocument()
    expect(screen.getByText(/修订 3 · 共 10 秒 · 2 个片段/)).toBeInTheDocument()
  })

  it('a blocking issue blocks rendering, with the reason written out and an action that goes to the fix', async () => {
    setup({ issues: [blocking] })
    const render = (await screen.findAllByRole('button', { name: '渲染成片' }))[0]!
    expect(render).toBeDisabled()
    expect(screen.getAllByText(/有 1 个阻断问题/).length).toBeGreaterThan(0)
    // the page uses its own copy for the issue, not the server's message
    expect(screen.getByRole('heading', { name: /阻断:\s*c2 没有视频/ })).toBeInTheDocument()
    expect(screen.queryByText('raw server text')).toBeNull()
    expect(screen.getByRole('link', { name: '去分镜页' })).toHaveAttribute(
      'href',
      '/projects/proj_1/episodes/ep_1/storyboard',
    )
  })

  it('an issue with a select action opens the clip inspector', async () => {
    setup({
      issues: [
        {
          severity: 'warning',
          code: 'NARRATION_OVERLAPS_NEXT',
          clipId: 'clip_1',
          shotId: 'shot_1',
          message: '',
        },
      ],
    })
    await userEvent.click(await screen.findByRole('button', { name: '选中这个片段' }))
    expect(await screen.findByRole('region', { name: '片段设置' })).toBeInTheDocument()
  })

  it('editing a clip appends a revision on top of the one it was looking at, with a readable summary', async () => {
    const { server } = setup()
    await userEvent.click(await screen.findByRole('button', { name: /片段 c1/ }))
    const volume = await screen.findByLabelText('原声音量（0 到 1）')
    await userEvent.clear(volume)
    await userEvent.type(volume, '0.8')
    await userEvent.tab()
    await waitFor(() => expect(server.calls.some((c) => c.method === 'PUT')).toBe(true))
    const put = server.calls.find((c) => c.method === 'PUT')!.body as {
      content: { clips: { sourceVolume: number }[] }
      summary: string
      baseRevision: number
    }
    expect(put.content.clips[0]!.sourceVolume).toBe(0.8)
    expect(put.baseRevision).toBe(3)
    expect(put.summary).toBe('调整 c1 的原声音量')
  })

  it('rolling back asks the server for that revision', async () => {
    const { server } = setup()
    await userEvent.click(await screen.findByRole('button', { name: '回到修订 2' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.path.endsWith('/rollback'))?.body).toEqual({ revision: 2 }),
    )
  })

  it('the render dialog disables burned-in subtitles when ffmpeg cannot do them, then starts the render', async () => {
    const { server } = setup({
      system: makeSystem({
        ffmpeg: { found: true, ok: true, features: { subtitleBurnIn: false }, missing: [] },
      }),
    })
    await userEvent.click((await screen.findAllByRole('button', { name: '渲染成片' }))[0]!)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: '烧进画面' })).toBeDisabled()
    expect(within(dialog).getByText(/没有字幕滤镜/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('radio', { name: '720p' }))
    await userEvent.click(within(dialog).getByRole('button', { name: '开始渲染' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.path.endsWith('/compose'))?.body).toEqual({
        subtitles: 'soft',
        shortSide: 720,
      }),
    )
  })

  it('an empty timeline points back to the storyboard', async () => {
    setup({
      timeline: makeTimeline({
        clips: [],
        issues: [{ severity: 'blocking', code: 'EMPTY_TIMELINE', message: '' }],
      }),
    })
    expect(await screen.findByRole('heading', { name: '还没有可合成的镜头' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /去分镜页/ })).toBeInTheDocument()
  })

  it('shows render progress while the render job runs', async () => {
    setup({
      jobs: [
        makeJob({
          type: 'render',
          operation: 'compose',
          episodeId: 'ep_1',
          paid: false,
          status: 'running',
          startedAt: 1,
          progress: 0.4,
        }),
      ],
    })
    expect(await screen.findByText('正在渲染……')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '渲染成片' })).toBeInTheDocument()
  })
})
