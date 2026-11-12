import { Route, Routes } from 'react-router'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { GenerateItem, Shot } from '@dramai/api'
import { StoryboardPage } from '@/features/storyboard/StoryboardPage'
import { failedJob, fakeServer, makeJob } from './fixtures'
import {
  makeAsset,
  makeEpisodeDetail,
  makePreflight,
  makeProvider,
  makeShot,
  makeVerdict,
  makeCapabilityView,
  slotWith,
  staleReport,
} from './fixtures-production'
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
  counters: { episode: 1, scene: 1, shot: 4, asset: 2, material: 1 },
  createdAt: 1,
  updatedAt: 1,
}
const noCandidates = {
  items: [],
  progress: { total: 0, pending: 0, accepted_new: 0, linked: 0, ignored: 0, handled: 0 },
}

function setup(opts: {
  shots: Shot[]
  assets?: ReturnType<typeof makeAsset>[]
  refs?: { shotId: string; assetId: string; variantName?: string }[]
  verdicts?: (items: GenerateItem[]) => ReturnType<typeof makePreflight>
  artifacts?: ReturnType<typeof staleReport>[]
  jobs?: ReturnType<typeof makeJob>[]
  routes?: Parameters<typeof fakeServer>[0]
}) {
  const detail = makeEpisodeDetail(opts.shots)
  detail.refs = opts.refs ?? []
  const server = fakeServer({
    'GET /api/projects/proj_1': () => project,
    'GET /api/episodes/ep_1': () => detail,
    'GET /api/episodes/ep_1/artifacts': () => ({ items: opts.artifacts ?? [] }),
    'GET /api/projects/proj_1/assets': () => ({ items: opts.assets ?? [] }),
    'GET /api/projects/proj_1/candidates': () => noCandidates,
    'GET /api/jobs': () => ({ items: opts.jobs ?? [] }),
    'GET /api/settings': () => ({
      activeProviders: { image: 'prov_i', video: 'prov_v' },
      cost: {},
    }),
    'GET /api/providers': () => ({ items: [makeProvider()] }),
    'GET /api/providers/prov_v/capability': () => makeCapabilityView(),
    'POST /api/projects/proj_1/preflight': ({ body }) => {
      const items = (body as { items: GenerateItem[] }).items
      return opts.verdicts
        ? opts.verdicts(items)
        : makePreflight(
            items.map((it) =>
              makeVerdict(`${it.target.kind}:${(it.target as { shotId: string }).shotId}`),
            ),
          )
    },
    ...opts.routes,
  })
  const view = renderApp(
    <Routes>
      <Route
        path="/projects/:projectId/episodes/:episodeId/storyboard"
        element={<StoryboardPage />}
      />
    </Routes>,
    { client: server.client, route: '/projects/proj_1/episodes/ep_1/storyboard' },
  )
  return { ...view, server }
}

const card = (n: number) => screen.findByTestId(`shot-${n}`)

describe('storyboard instructions and cross-scene moves', () => {
  const twoScenes = () => {
    const shots = [makeShot({ id: 'a' }), makeShot({ id: 'b' }), makeShot({ id: 'c' })]
    const d = makeEpisodeDetail(shots)
    d.scenes = [
      { ...d.scenes[0]!, id: 'scene_1', shotOrder: ['a', 'b'] },
      { ...d.scenes[0]!, id: 'scene_2', number: 2, shotOrder: ['c'] },
    ]
    d.episode.sceneOrder = ['scene_1', 'scene_2']
    d.shots = d.shots.map((x) => ({ ...x, sceneId: x.id === 'c' ? 'scene_2' : 'scene_1' }))
    return d
  }

  it('the first breakdown can carry an instruction, which is sent as written', async () => {
    const { server } = setup({
      shots: [],
      routes: {
        'POST /api/episodes/ep_1/breakdown': () => ({
          job: makeJob({ type: 'text', operation: 'episode_breakdown', paid: false }),
          deduped: false,
        }),
      },
    })
    await userEvent.type(await screen.findByLabelText('分镜指令'), '每镜不超过 8 秒')
    await userEvent.click(screen.getByRole('button', { name: '拆分镜头' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.path.endsWith('/breakdown'))?.body).toEqual({
        instructions: '每镜不超过 8 秒',
      }),
    )
  })

  it('a remembered instruction is shown, can be saved alone, and re-splitting sends it again', async () => {
    const detail = makeEpisodeDetail([makeShot({ id: 'a' })])
    detail.episode.breakdownInstructions = '重点表现心理变化'
    const { server } = setup({
      shots: [makeShot({ id: 'a' })],
      routes: {
        'GET /api/episodes/ep_1': () => detail,
        'PATCH /api/episodes/ep_1': () => detail.episode,
        'POST /api/episodes/ep_1/breakdown': () => ({
          job: makeJob({ type: 'text', operation: 'episode_breakdown', paid: false }),
          deduped: false,
        }),
      },
    })
    await userEvent.click(await screen.findByText('拆分与提示词'))
    const box = screen.getByLabelText('分镜指令')
    expect(box).toHaveValue('重点表现心理变化')
    await userEvent.clear(box)
    await userEvent.type(box, '每镜 5 秒')
    await userEvent.click(screen.getByRole('button', { name: '只保存指令' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        breakdownInstructions: '每镜 5 秒',
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: '重新拆分镜头' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.path.endsWith('/breakdown'))?.body).toEqual({
        mode: 'append',
        instructions: '每镜 5 秒',
      }),
    )
  })

  it('moving the first shot of a scene up goes to the end of the previous scene, and the first shot of the episode cannot move up', async () => {
    const d = twoScenes()
    const { server } = setup({
      shots: [],
      routes: {
        'GET /api/episodes/ep_1': () => d,
        'POST /api/shots/c/move': () => d.shots[2],
        'PUT /api/scenes/scene_1/shot-order': () => d.scenes[0],
      },
    })
    expect(await within(await card(1)).findByRole('button', { name: '镜头 1 上移' })).toBeDisabled()
    await userEvent.click(within(await card(3)).getByRole('button', { name: '镜头 3 上移' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.path === '/api/shots/c/move')?.body).toEqual({
        toSceneId: 'scene_1',
      }),
    )
    // 场内仍然是调序
    await userEvent.click(within(await card(2)).getByRole('button', { name: '镜头 2 上移' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.path === '/api/scenes/scene_1/shot-order')?.body).toEqual({
        order: ['b', 'a'],
      }),
    )
  })
})

describe('storyboard page', () => {
  it('an empty episode offers to break it into shots, and does so through the breakdown endpoint', async () => {
    const { server } = setup({
      shots: [],
      routes: {
        'POST /api/episodes/ep_1/breakdown': () => ({
          job: makeJob({ type: 'text', operation: 'episode_breakdown', paid: false }),
          deduped: false,
        }),
      },
    })
    await userEvent.click(await screen.findByRole('button', { name: '拆分镜头' }))
    await waitFor(() =>
      expect(server.calls.some((c) => c.path === '/api/episodes/ep_1/breakdown')).toBe(true),
    )
  })

  it('while the breakdown runs, its streamed text panel is shown instead of the empty state', async () => {
    setup({
      shots: [],
      jobs: [
        makeJob({
          type: 'text',
          operation: 'episode_breakdown',
          episodeId: 'ep_1',
          paid: false,
          status: 'running',
          startedAt: 1,
        }),
      ],
    })
    expect(await screen.findByTestId('job-stream')).toBeInTheDocument()
    expect(screen.getByText('大模型正在拆分镜头…')).toBeInTheDocument()
    expect(screen.queryByText('还没有分镜')).toBeNull()
  })

  it('shows the header summary and the status bar', async () => {
    const shots = [
      makeShot({ id: 'a', image: slotWith('image'), video: slotWith('video') }),
      makeShot({ id: 'b', durationSec: 8 }),
    ]
    setup({ shots })
    expect(await screen.findByText(/分镜 · 1 场 · 2 个镜头 · 共 13 秒/)).toBeInTheDocument()
    const bar = screen.getByLabelText('本集状态')
    expect(bar).toHaveTextContent('2镜头')
    expect(bar).toHaveTextContent('1视频已生成')
  })

  it('“can’t generate” is shown before anything is clicked, with every missing thing and a way to fix it', async () => {
    const hero = makeAsset({ id: 'asset_1', name: '小宫女' })
    const letter = makeAsset({ id: 'asset_2', name: '信件', kind: 'prop' })
    const shot = makeShot({ id: 'a' })
    const { server } = setup({
      shots: [shot],
      assets: [hero, letter],
      refs: [
        { shotId: 'a', assetId: 'asset_1' },
        { shotId: 'a', assetId: 'asset_2' },
        { shotId: 'a', assetId: 'asset_gone' },
      ],
      verdicts: (items) =>
        makePreflight(
          items.map((it) =>
            it.target.kind === 'shot_image'
              ? makeVerdict(`shot_image:a`, {
                  status: 'blocked',
                  reasons: [
                    { code: 'ASSET_SHEET_MISSING', message: 'x', assetId: 'asset_2' },
                    { code: 'ASSET_NOT_REGISTERED', message: 'x' },
                  ],
                })
              : makeVerdict(`shot_video:a`),
          ),
        ),
    })
    const c = await card(1)
    expect(await within(c).findByText('还缺 2 项，不能生成')).toBeInTheDocument()
    expect(within(c).getByText(/「信件」还没有设定图/)).toBeInTheDocument()
    expect(within(c).getByRole('link', { name: '去补「信件」的设定图' })).toHaveAttribute(
      'href',
      '/projects/proj_1/assets/asset_2',
    )
    expect(within(c).getByRole('link', { name: '去确认候选' })).toHaveAttribute(
      'href',
      '/projects/proj_1/candidates',
    )
    expect(within(c).getByRole('button', { name: '生成图片' })).toBeDisabled()
    expect(within(c).getByText('不能生成')).toBeInTheDocument()
    // 引用的资产三态：正常 / 没有设定图 / 未登记
    const refs = within(c).getByRole('list', { name: '引用的资产' })
    expect(within(refs).getByText('小宫女')).toBeInTheDocument()
    expect(within(refs).getByText(/信件/)).toHaveTextContent('无设定图')
    expect(within(refs).getByText('未登记')).toBeInTheDocument()
    // 什么都没点，当然也没有生成请求
    expect(server.calls.some((x) => x.path.endsWith('/generate'))).toBe(false)
  })

  it('clicking generate opens the confirmation; nothing is created until it is confirmed', async () => {
    const { server } = setup({ shots: [makeShot({ id: 'a' })] })
    const c = await card(1)
    await userEvent.click(await within(c).findByRole('button', { name: '生成图片' }))
    expect(await screen.findByRole('dialog', { name: /批量生成分镜图/ })).toBeInTheDocument()
    expect(server.calls.some((x) => x.path.endsWith('/generate'))).toBe(false)
  })

  it('a stale version names what changed upstream, offers regenerate, and “keep as is” hides the notice', async () => {
    const hero = makeAsset({ id: 'asset_1', name: '小宫女', sheet: slotWith('image', 2) })
    const shot = makeShot({ id: 'a', image: slotWith('image'), video: slotWith('video') })
    const report = staleReport('shot_video:a', [
      {
        kind: 'upstream',
        key: 'asset_sheet:asset_1',
        from: { versionId: hero.sheet.versions[0]!.id, contentHash: 'h1' },
        to: { versionId: hero.sheet.versions[1]!.id, contentHash: 'h2' },
      },
    ])
    // 服务端记状态：保持现状之后，这件产物是 current，并带 keptAt
    let current = report
    const { server } = setup({
      shots: [shot],
      assets: [hero],
      refs: [{ shotId: 'a', assetId: 'asset_1' }],
      routes: {
        'GET /api/episodes/ep_1/artifacts': () => ({ items: [current] }),
        'POST /api/projects/proj_1/artifacts/keep': () => {
          current = { ...report, status: 'current', reason: undefined, keptAt: 5 }
          return current
        },
      },
    })
    const c = await card(1)
    expect(await within(c).findByText('这一版已过期')).toBeInTheDocument()
    expect(
      within(c).getByText(/「小宫女」的设定图从 v1 更新到了 v2，这个镜头是用 v1 生成的/),
    ).toBeInTheDocument()
    expect(within(c).getByText(/它仍然可用，dramai 不会自动重新生成/)).toBeInTheDocument()
    expect(within(c).getAllByText('已过期').length).toBeGreaterThan(0) // 状态胶囊
    expect(within(c).getByRole('button', { name: '用新依据重新生成' })).toBeInTheDocument()
    await userEvent.click(within(c).getByRole('button', { name: '保持现状' }))
    await waitFor(() =>
      expect(server.calls.find((x) => x.path.endsWith('/artifacts/keep'))?.body).toEqual({
        key: 'shot_video:a',
      }),
    )
    expect(await within(c).findByTestId('kept-note')).toHaveTextContent('已按现状保留')
    expect(within(c).queryByText('这一版已过期')).toBeNull()
  })

  it('a failed video shows the failure with the same actions as the task panel: resume first, regenerate flagged as chargeable', async () => {
    const shot = makeShot({
      id: 'a',
      image: slotWith('image'),
      stages: { image: 'succeeded', video: 'failed', audio: 'pending' },
      failedStage: 'video',
    })
    const job = failedJob('delivery_failed', { id: 'job_f', shotId: 'a', operation: 'shot_video' })
    const { server } = setup({
      shots: [shot],
      jobs: [job],
      routes: { 'POST /api/jobs/job_f/resume': () => makeJob({ id: 'job_f', status: 'queued' }) },
    })
    const c = await card(1)
    expect(await within(c).findByText('视频生成失败')).toBeInTheDocument()
    expect(within(c).getByText(/上游任务还在，可以恢复/)).toBeInTheDocument()
    expect(within(c).getByRole('button', { name: '重新生成（可能再次计费）' })).toBeInTheDocument()
    await userEvent.click(within(c).getByRole('button', { name: '恢复原任务' }))
    await waitFor(() =>
      expect(server.calls.some((x) => x.path === '/api/jobs/job_f/resume')).toBe(true),
    )
  })

  it('a running video is not cancellable from the card; a queued image is', async () => {
    const running = makeShot({
      id: 'a',
      image: slotWith('image'),
      stages: { image: 'succeeded', video: 'running', audio: 'pending' },
    })
    const queued = makeShot({
      id: 'b',
      stages: { image: 'queued', video: 'pending', audio: 'pending' },
    })
    const { server } = setup({
      shots: [running, queued],
      jobs: [
        makeJob({
          id: 'job_q',
          shotId: 'b',
          operation: 'shot_image',
          type: 'image',
          status: 'queued',
          queuePosition: 1,
        }),
      ],
      routes: {
        'POST /api/jobs/job_q/cancel': () => makeJob({ id: 'job_q', status: 'cancelled' }),
      },
    })
    const a = await card(1)
    expect(within(a).queryByRole('button', { name: '取消排队' })).toBeNull()
    expect(within(a).getByRole('button', { name: '查看任务' })).toBeInTheDocument()
    const b = await card(2)
    await userEvent.click(within(b).getByRole('button', { name: '取消排队' }))
    await waitFor(() =>
      expect(server.calls.some((x) => x.path === '/api/jobs/job_q/cancel')).toBe(true),
    )
  })

  it('version history: older versions can be made current, regenerating never overwrites', async () => {
    const shot = makeShot({ id: 'a', image: slotWith('image', 2) })
    const { server } = setup({
      shots: [shot],
      routes: { 'PUT /api/shots/a/current-version': () => shot },
    })
    const c = await card(1)
    expect(within(c).getByText(/（共 2 版）/)).toBeInTheDocument()
    await userEvent.click(within(c).getByRole('button', { name: '版本历史' }))
    expect(within(c).getByText(/重新生成不会覆盖旧版本/)).toBeInTheDocument()
    await userEvent.click(within(c).getByRole('button', { name: '把画面 v1 设为当前' }))
    await waitFor(() =>
      expect(server.calls.some((x) => x.path === '/api/shots/a/current-version')).toBe(true),
    )
    expect(server.calls.find((x) => x.path === '/api/shots/a/current-version')!.body).toEqual({
      slot: 'image',
      versionId: shot.image.versions[0]!.id,
    })
  })

  it('reordering moves a shot within its scene', async () => {
    const { server } = setup({
      shots: [makeShot({ id: 'a' }), makeShot({ id: 'b' }), makeShot({ id: 'c' })],
      routes: { 'PUT /api/scenes/scene_1/shot-order': () => ({}) },
    })
    const c = await card(2)
    await userEvent.click(within(c).getByRole('button', { name: '镜头 2 上移' }))
    await waitFor(() =>
      expect(server.calls.some((x) => x.path === '/api/scenes/scene_1/shot-order')).toBe(true),
    )
    expect(server.calls.find((x) => x.path === '/api/scenes/scene_1/shot-order')!.body).toEqual({
      order: ['b', 'a', 'c'],
    })
    // 第一个不能再上移，最后一个不能再下移
    expect(within(await card(1)).getByRole('button', { name: '镜头 1 上移' })).toBeDisabled()
    expect(within(await card(3)).getByRole('button', { name: '镜头 3 下移' })).toBeDisabled()
  })

  it('deleting asks first', async () => {
    const { server } = setup({
      shots: [makeShot({ id: 'a' })],
      routes: { 'DELETE /api/shots/a': () => ({ ok: true }) },
    })
    await userEvent.click(within(await card(1)).getByRole('button', { name: '删除镜头 1' }))
    const dlg = await screen.findByRole('dialog')
    expect(server.calls.some((x) => x.method === 'DELETE')).toBe(false)
    await userEvent.click(within(dlg).getByRole('button', { name: '删除' }))
    await waitFor(() =>
      expect(server.calls.some((x) => x.method === 'DELETE' && x.path === '/api/shots/a')).toBe(
        true,
      ),
    )
  })

  it('editing shows prompts with asset names and saves them back as stable ids', async () => {
    const hero = makeAsset({ id: 'asset_1', name: '小宫女' })
    const shot = makeShot({
      id: 'a',
      prompts: { firstFrame: '@{asset_1} walks', video: '@{asset_1} turns' },
    })
    const { server } = setup({
      shots: [shot],
      assets: [hero],
      routes: { 'PATCH /api/shots/a': () => shot },
    })
    await userEvent.click(within(await card(1)).getByRole('button', { name: '编辑' }))
    const dlg = await screen.findByRole('dialog', { name: /编辑镜头 1/ })
    const first = within(dlg).getByLabelText('首帧提示词')
    expect(first).toHaveValue('@小宫女 walks')
    await userEvent.type(first, ' slowly')
    await userEvent.click(within(dlg).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(server.calls.some((x) => x.method === 'PATCH' && x.path === '/api/shots/a')).toBe(
        true,
      ),
    )
    const body = server.calls.find((x) => x.method === 'PATCH')!.body as {
      prompts: { firstFrame: string; video: string }
      durationSec: number
    }
    expect(body.prompts).toEqual({
      firstFrame: '@{asset_1} walks slowly',
      video: '@{asset_1} turns',
    })
    expect(body.durationSec).toBe(5)
  })

  it('English copy', async () => {
    await useLocale('en')
    setup({ shots: [makeShot({ id: 'a' })] })
    const c = await card(1)
    expect(await within(c).findByRole('button', { name: 'Generate image' })).toBeInTheDocument()
    expect(screen.getByText(/Storyboard · 1 scenes · 1 shots/)).toBeInTheDocument()
  })
})
