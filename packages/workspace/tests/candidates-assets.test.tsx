import { Route, Routes } from 'react-router'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Candidate } from '@dramai/api'
import { AssetDetailPage } from '@/features/assets/AssetDetailPage'
import { AssetsPage } from '@/features/assets/AssetsPage'
import { CandidatesPage } from '@/features/candidates/CandidatesPage'
import { fakeServer } from './fixtures'
import {
  makeAsset,
  makeCandidate,
  makeEpisodeDetail,
  makeProvider,
  makeCapabilityView,
  makePreflight,
  makeShot,
  makeVerdict,
  slotWith,
} from './fixtures-production'
import { renderApp, useLocale } from './render'

beforeEach(async () => {
  await useLocale('zh-CN')
})

const progress = (items: Candidate[]) => {
  const count = (s: Candidate['status']) => items.filter((c) => c.status === s).length
  const handled = items.length - count('pending')
  return {
    total: items.length,
    pending: count('pending'),
    accepted_new: count('accepted_new'),
    linked: count('linked'),
    ignored: count('ignored'),
    handled,
  }
}

const episodeRow = {
  schemaVersion: 1,
  id: 'ep_1',
  projectId: 'proj_1',
  number: 2,
  title: '那封信',
  status: 'storyboarding' as const,
  sceneOrder: ['scene_1'],
  createdAt: 1,
  updatedAt: 1,
  progress: makeEpisodeDetail([]).progress,
}

function base(
  items: Candidate[],
  assets = [makeAsset({ id: 'asset_chief', name: '总管太监' })],
  routes: Parameters<typeof fakeServer>[0] = {},
) {
  const shots = [makeShot({ id: 's1' }), makeShot({ id: 's2' })]
  return fakeServer({
    'GET /api/projects/proj_1/candidates': () => ({ items, progress: progress(items) }),
    'GET /api/projects/proj_1/assets': () => ({ items: assets }),
    'GET /api/projects/proj_1/episodes': () => ({ items: [episodeRow] }),
    'GET /api/episodes/ep_1': () => makeEpisodeDetail(shots),
    ...routes,
  })
}

describe('candidates page', () => {
  const view = (server: ReturnType<typeof base>) =>
    renderApp(
      <Routes>
        <Route path="/projects/:projectId/candidates" element={<CandidatesPage />} />
      </Routes>,
      { client: server.client, route: '/projects/proj_1/candidates' },
    )

  it('groups pending candidates by kind and shows confidence, first appearance and the evidence quote', async () => {
    view(
      base([
        makeCandidate({
          id: 'c1',
          name: '掌事姑姑',
          kind: 'character',
          confidenceBand: 'high',
          shotIds: ['s2', 's1'],
        }),
        makeCandidate({
          id: 'c2',
          name: '油灯',
          kind: 'prop',
          confidenceBand: 'low',
          evidence: '案上的一盏油灯还亮着。',
          shotIds: [],
        }),
      ]),
    )
    const row = await screen.findByTestId('candidate-掌事姑姑')
    expect(within(row).getByText('置信度 高')).toBeInTheDocument()
    expect(within(row).getByText('首次出现：第 2 集 镜头 01')).toBeInTheDocument()
    expect(within(row).getByText(/出现在：第 2 集 镜头 01、第 2 集 镜头 02/)).toBeInTheDocument()
    expect(within(row).getByText('掌事姑姑站在门外，没有进来。')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '角色' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '道具' })).toBeInTheDocument()
    const lamp = screen.getByTestId('candidate-油灯')
    expect(within(lamp).getByText('置信度 低')).toBeInTheDocument()
    expect(within(lamp).getByText('首次出现：没有出现在镜头里')).toBeInTheDocument()
    expect(screen.getByText('已处理 0 / 2')).toBeInTheDocument()
  })

  it('confirm as new sends accept, with the variants that are ticked', async () => {
    const server = base(
      [
        makeCandidate({
          id: 'c1',
          name: '小宫女',
          variants: [{ variantKey: '披斗篷', description: '雪夜', affectedShotIds: ['s1'] }],
        }),
      ],
      [],
      {
        'POST /api/candidates/c1/accept': () => ({
          candidate: makeCandidate({ id: 'c1', status: 'accepted_new' }),
        }),
      },
    )
    view(server)
    const row = await screen.findByTestId('candidate-小宫女')
    await userEvent.click(within(row).getByRole('button', { name: '确认为新资产' }))
    await waitFor(() =>
      expect(server.calls.some((c) => c.path === '/api/candidates/c1/accept')).toBe(true),
    )
    expect(server.calls.find((c) => c.path.endsWith('/accept'))!.body).toEqual({
      createVariants: ['披斗篷'],
    })
  })

  it('unticking a variant leaves it out', async () => {
    const server = base(
      [
        makeCandidate({
          id: 'c1',
          name: '小宫女',
          variants: [{ variantKey: '披斗篷', description: '雪夜', affectedShotIds: [] }],
        }),
      ],
      [],
      {
        'POST /api/candidates/c1/accept': () => ({
          candidate: makeCandidate({ id: 'c1', status: 'accepted_new' }),
        }),
      },
    )
    view(server)
    const row = await screen.findByTestId('candidate-小宫女')
    await userEvent.click(within(row).getByRole('checkbox'))
    await userEvent.click(within(row).getByRole('button', { name: '确认为新资产' }))
    await waitFor(() => expect(server.calls.some((c) => c.path.endsWith('/accept'))).toBe(true))
    expect(server.calls.find((c) => c.path.endsWith('/accept'))!.body).toEqual({})
  })

  it('a suggested match makes “link to” the primary action and keeps “create another” available', async () => {
    const server = base(
      [
        makeCandidate({
          id: 'c1',
          name: '老太监',
          suggestedMatch: { assetId: 'asset_chief', score: 0.8, basis: [{ type: 'alias' }] },
        }),
      ],
      undefined,
      {
        'POST /api/candidates/c1/link': () => ({
          candidate: makeCandidate({ id: 'c1', status: 'linked' }),
        }),
      },
    )
    view(server)
    const row = await screen.findByTestId('candidate-老太监')
    expect(within(row).getByText(/可能和已有角色「总管太监」是同一个/)).toBeInTheDocument()
    expect(within(row).getByText('依据：和它的别名一致')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: '新建为另一个角色' })).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: '确认为新资产' })).toBeNull()
    await userEvent.click(within(row).getByRole('button', { name: '关联到「总管太监」' }))
    await waitFor(() =>
      expect(server.calls.some((c) => c.path === '/api/candidates/c1/link')).toBe(true),
    )
    expect(server.calls.find((c) => c.path.endsWith('/link'))!.body).toEqual({
      assetId: 'asset_chief',
    })
  })

  it('link to an existing asset from the menu lists only assets of the same kind', async () => {
    const server = base(
      [makeCandidate({ id: 'c1', name: '宫女', kind: 'character' })],
      [
        makeAsset({ id: 'asset_1', name: '小宫女' }),
        makeAsset({ id: 'asset_2', name: '宫墙', kind: 'location' }),
      ],
      {
        'POST /api/candidates/c1/link': () => ({
          candidate: makeCandidate({ id: 'c1', status: 'linked' }),
        }),
      },
    )
    view(server)
    const row = await screen.findByTestId('candidate-宫女')
    await userEvent.click(within(row).getByRole('button', { name: /关联到已有/ }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: '小宫女' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: '宫墙' })).toBeNull()
    await userEvent.click(within(menu).getByRole('menuitem', { name: '小宫女' }))
    await waitFor(() => expect(server.calls.some((c) => c.path.endsWith('/link'))).toBe(true))
    expect(server.calls.find((c) => c.path.endsWith('/link'))!.body).toEqual({ assetId: 'asset_1' })
  })

  it('ignore calls ignore; the handled list can undo a link', async () => {
    const server = base(
      [
        makeCandidate({ id: 'c1', name: '御花园', kind: 'location', confidenceBand: 'low' }),
        makeCandidate({
          id: 'c2',
          name: '老太监',
          status: 'linked',
          linkedAssetId: 'asset_chief',
          linkSource: 'auto',
        }),
      ],
      undefined,
      {
        'POST /api/candidates/c1/ignore': () => ({
          candidate: makeCandidate({ id: 'c1', status: 'ignored' }),
        }),
        'POST /api/candidates/c2/undo-link': () => ({
          candidate: makeCandidate({ id: 'c2' }),
          removedVariants: [],
          keptVariants: [],
        }),
      },
    )
    view(server)
    await userEvent.click(
      within(await screen.findByTestId('candidate-御花园')).getByRole('button', { name: '忽略' }),
    )
    await waitFor(() =>
      expect(server.calls.some((c) => c.path === '/api/candidates/c1/ignore')).toBe(true),
    )
    expect(screen.getByText('名字完全一致，已自动关联到「总管太监」')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '撤销关联' }))
    await waitFor(() =>
      expect(server.calls.some((c) => c.path === '/api/candidates/c2/undo-link')).toBe(true),
    )
  })

  it('a refusal is explained by its code', async () => {
    const server = base([makeCandidate({ id: 'c1', name: '信', kind: 'prop' })], [], {
      'POST /api/candidates/c1/accept': () => ({
        __status: 409,
        body: {
          error: { code: 'ASSET_NAME_TAKEN', message: 'ignored', details: { assetId: 'a' } },
        },
      }),
    })
    view(server)
    await userEvent.click(
      within(await screen.findByTestId('candidate-信')).getByRole('button', {
        name: '确认为新资产',
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('已经有同名的资产了')
  })
})

describe('assets pages', () => {
  const library = (server: ReturnType<typeof base>) =>
    renderApp(
      <Routes>
        <Route path="/projects/:projectId/assets" element={<AssetsPage />} />
      </Routes>,
      { client: server.client, route: '/projects/proj_1/assets' },
    )

  it('lists assets by kind, with a hole where the sheet is missing and what that blocks', async () => {
    const detail = makeEpisodeDetail([makeShot({ id: 's1' })])
    detail.refs = [{ shotId: 's1', assetId: 'asset_prop' }]
    const server = base(
      [],
      [
        makeAsset({ id: 'asset_hero', name: '小宫女', sheet: slotWith('image', 3) }),
        makeAsset({ id: 'asset_prop', name: '信件', kind: 'prop' }),
      ],
      {
        'GET /api/episodes/ep_1': () => detail,
      },
    )
    library(server)
    const hero = await screen.findByRole('link', { name: /小宫女/ })
    expect(within(hero).getByText('设定图 v3')).toBeInTheDocument()
    expect(within(hero).getByText('没有音色参考')).toBeInTheDocument()
    const letter = await screen.findByRole('link', { name: /信件/ })
    await waitFor(() =>
      expect(within(letter).getByText('还没有设定图，引用它的镜头不能生成')).toBeInTheDocument(),
    )
    expect(within(letter).getByText('被 1 个镜头引用')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '服装' })).toBeInTheDocument()
  })

  it('shows how many candidates are waiting', async () => {
    library(
      base(
        [makeCandidate({ id: 'c1' }), makeCandidate({ id: 'c2', name: '油灯', kind: 'prop' })],
        [],
      ),
    )
    expect(await screen.findByText('2 个候选等你确认')).toBeInTheDocument()
  })

  it('new asset: the name is required only after trying to submit, and a clash is explained by its code', async () => {
    const server = base([], [], {
      'POST /api/projects/proj_1/assets': () => ({
        __status: 409,
        body: {
          error: { code: 'ASSET_NAME_TAKEN', message: 'ignored', details: { assetId: 'x' } },
        },
      }),
    })
    library(server)
    await userEvent.click((await screen.findAllByRole('button', { name: '新建资产' }))[0]!)
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).queryByRole('alert')).toBeNull()
    await userEvent.click(within(dlg).getByRole('button', { name: '创建' }))
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('请填写名字')
    await userEvent.type(within(dlg).getByRole('textbox', { name: /名字/ }), '小宫女')
    await userEvent.click(within(dlg).getByRole('button', { name: '创建' }))
    await waitFor(() =>
      expect(within(dlg).getByRole('alert')).toHaveTextContent('已经有同名的资产了'),
    )
  })

  const detail = (
    asset: ReturnType<typeof makeAsset>,
    extra: Parameters<typeof fakeServer>[0] = {},
  ) => {
    const server = base([], [asset], {
      'GET /api/assets/asset_hero': () => ({ asset, usedByShotIds: ['s1'] }),
      'GET /api/projects/proj_1': () => ({
        schemaVersion: 1,
        id: 'proj_1',
        name: 'p',
        aspectRatio: '9:16',
        style: { source: 'none', label: '', description: '', imageKeywords: '', expandedAt: 1 },
        narrationDelivery: 'tts',
        episodeOrder: [],
        counters: { episode: 1, scene: 1, shot: 1, asset: 1, material: 1 },
        createdAt: 1,
        updatedAt: 1,
      }),
      'GET /api/projects/proj_1/artifacts': () => ({ items: [] }),
      'GET /api/jobs': () => ({ items: [] }),
      'GET /api/settings': () => ({ activeProviders: { image: 'prov_i' }, cost: {} }),
      'GET /api/providers': () => ({
        items: [
          makeProvider({
            id: 'prov_i',
            kind: 'image',
            protocol: 'gemini-image',
            label: 'Nano Banana',
          }),
        ],
      }),
      'GET /api/providers/prov_i/capability': () => makeCapabilityView(),
      'POST /api/projects/proj_1/preflight': ({ body }) =>
        makePreflight(
          (body as { items: { target: { assetId: string } }[] }).items.map((i) =>
            makeVerdict(`asset_sheet:${i.target.assetId}`),
          ),
        ),
      ...extra,
    })
    renderApp(
      <Routes>
        <Route path="/projects/:projectId/assets/:assetId" element={<AssetDetailPage />} />
      </Routes>,
      { client: server.client, route: '/projects/proj_1/assets/asset_hero' },
    )
    return server
  }

  it('detail: sheet versions can be switched, and the page says regenerating adds a version instead of overwriting', async () => {
    const asset = makeAsset({
      id: 'asset_hero',
      name: '小宫女',
      sheet: slotWith('image', 3),
      appearance: '十六七岁，圆脸杏眼',
    })
    const server = detail(asset, { 'PUT /api/assets/asset_hero/sheet/current': () => asset })
    expect(await screen.findByRole('heading', { name: '小宫女' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('十六七岁，圆脸杏眼')).toBeInTheDocument()
    expect(screen.getByText(/重新生成不会覆盖旧图，只会追加一个新版本/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '把设定图 v1 设为当前' }))
    await waitFor(() =>
      expect(server.calls.some((c) => c.path === '/api/assets/asset_hero/sheet/current')).toBe(
        true,
      ),
    )
    expect(server.calls.find((c) => c.path.endsWith('/sheet/current'))!.body).toEqual({
      versionId: asset.sheet.versions[0]!.id,
    })
  })

  it('detail: generating a sheet goes through the confirmation first', async () => {
    const asset = makeAsset({ id: 'asset_hero', name: '小宫女' })
    const server = detail(asset)
    await userEvent.click(await screen.findByRole('button', { name: '生成设定图' }))
    expect(await screen.findByRole('dialog', { name: '生成设定图' })).toBeInTheDocument()
    expect(server.calls.some((c) => c.path.endsWith('/generate'))).toBe(false)
  })

  it('detail: a variant edited from the base goes stale with it, an uploaded one never does', async () => {
    const base0 = slotWith('image', 2)
    const asset = makeAsset({
      id: 'asset_hero',
      name: '小宫女',
      sheet: base0,
      variants: [
        {
          name: '冬装',
          description: '深蓝冬服',
          origin: 'edit',
          editInstruction: 'x',
          sheet: slotWith('image'),
        },
        { name: '便装', description: '你的成品', origin: 'upload', sheet: slotWith('image') },
      ],
    })
    detail(asset, {
      'GET /api/projects/proj_1/artifacts': () => ({
        items: [
          {
            key: 'variant_sheet:asset_hero/冬装',
            kind: 'variant_sheet',
            status: 'stale',
            reason: 'upstream_changed',
            changes: [],
            staleUpstream: [],
          },
          {
            key: 'variant_sheet:asset_hero/便装',
            kind: 'variant_sheet',
            status: 'stale',
            reason: 'upstream_changed',
            changes: [],
            staleUpstream: [],
          },
        ],
      }),
    })
    const winter = (await screen.findByRole('heading', { name: /冬装/ })).closest('li')!
    await waitFor(() => expect(within(winter).getByText('已过期')).toBeInTheDocument())
    expect(within(winter).getByRole('button', { name: '基于 v2 重新生成' })).toBeInTheDocument()
    const casual = screen.getByRole('heading', { name: /便装/ }).closest('li')!
    expect(within(casual).queryByText('已过期')).toBeNull()
    expect(within(casual).getByText(/不随本体变化而过期/)).toBeInTheDocument()
  })

  it('detail: a character’s voice reference is shown with a player, other kinds have none', async () => {
    const asset = makeAsset({
      id: 'asset_hero',
      name: '小宫女',
      voiceRef: { path: 'audio/v.wav', mime: 'audio/wav', bytes: 1, sha256: 'x' },
    })
    detail(asset)
    expect(await screen.findByLabelText('试听小宫女的音色参考')).toBeInTheDocument()
  })

  it('detail: deletion explains itself by code when the asset is still used', async () => {
    const asset = makeAsset({ id: 'asset_hero', name: '小宫女' })
    detail(asset, {
      'DELETE /api/assets/asset_hero': () => ({
        __status: 409,
        body: { error: { code: 'ASSET_IN_USE', message: 'ignored', details: { shotIds: ['s1'] } } },
      }),
    })
    await userEvent.click(await screen.findByRole('button', { name: '删除' }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.click(within(dlg).getByRole('button', { name: '删除' }))
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('这个资产还被引用着，不能删除')
  })
})
