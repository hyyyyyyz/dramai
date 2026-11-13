import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerateItem, MediaSlot, VideoPlan } from '@dramai/api'
import { PreviewPlayer } from '@/features/compose/PreviewPlayer'
import { BatchConfirmDialog } from '@/features/storyboard/BatchConfirmDialog'
import type { BatchCandidate } from '@/features/storyboard/batch-model'
import { VersionStrip } from '@/features/storyboard/VersionStrip'
import { ALL_PROTOCOLS, PROTOCOLS_BY_KIND, kindOfProtocol } from '@/features/settings/protocols'
import { providerErrorOf } from '@/features/settings/provider-model'
import { ProvidersPage } from '@/features/settings/ProvidersPage'
import { ProviderErrorNotice } from '@/features/jobs/ProviderErrorNotice'
import en from '@/i18n/locales/en'
import zhTW from '@/i18n/locales/zh-TW'
import zh from '@/i18n/locales/zh-CN'
import { ApiContext } from '@/data/contexts'
import { MemoryRouter } from 'react-router'
import { Route, Routes } from 'react-router'
import { ComposePage } from '@/features/compose/ComposePage'
import { fakeServer, makeSystem } from './fixtures'
import { makeTimeline, placedClip } from './fixtures-compose'
import {
  makeCapabilityView,
  makeEpisodeDetail,
  makePreflight,
  makeProvider,
  makeShot,
  makeVerdict,
  slotWith,
} from './fixtures-production'
import { makeKeyProvider, makePreset } from './fixtures-providers'
import { renderApp, useLocale } from './render'

const memoryStorage = () => {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  }
}
// (not a React hook, despite the name: an alias so the lint rule doesn't read calls in a loop as hook calls)
const switchLocale = useLocale
beforeEach(async () => {
  vi.stubGlobal('localStorage', memoryStorage())
  await useLocale('zh-CN')
})
afterEach(() => vi.unstubAllGlobals())

// ---------------------------------------------------------------- protocols, presets, errors

describe('the three new video protocols', () => {
  const NEW = ['ark-video', 'kling-contents', 'dashscope-video'] as const
  it('are video protocols a custom provider can pick, with a name in every language', () => {
    for (const p of NEW) {
      expect(kindOfProtocol(p)).toBe('video')
      expect(PROTOCOLS_BY_KIND.video).toContain(p)
      expect(ALL_PROTOCOLS).toContain(p)
      for (const dict of [zh, zhTW, en])
        expect((dict.protocol as Record<string, string>)[p], p).toBeTruthy()
    }
  })
})

describe('video presets in the catalog', () => {
  const vendor = (id: string, label: string) => ({ id, label })
  const presets = [
    makePreset({
      id: 'byteplus-seedance',
      kind: 'video',
      label: 'BytePlus Seedance',
      vendor: vendor('byteplus', 'BytePlus'),
      region: 'global',
      protocol: 'ark-video',
      baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3',
      suggestedModel: 'dreamina-seedance-2-0-260128',
      verification: { status: 'documented', source: 'https://docs.byteplus.com/x' },
      verifiedAt: undefined,
      knownLimitations: [
        'Reference videos and audio are not sent yet',
        'Real human faces are refused',
      ],
    }),
    makePreset({
      id: 'kling-video-cn',
      kind: 'video',
      label: 'Kling 4.0 (China)',
      vendor: vendor('kling', 'Kling'),
      region: 'cn',
      protocol: 'kling-contents',
      baseUrl: 'https://api-beijing.klingai.com',
      suggestedModel: 'kling-4.0',
      verification: { status: 'documented', source: 'https://kling.ai/doc' },
      verifiedAt: undefined,
    }),
    makePreset({
      id: 'aliyun-wan3-cn',
      kind: 'video',
      label: 'Wan 3.0 (China)',
      vendor: vendor('aliyun', 'Alibaba Cloud'),
      region: 'cn',
      protocol: 'dashscope-video',
      baseUrl: 'https://{WorkspaceId}.dashscope.aliyuncs.com/api/v1',
      baseUrlPlaceholders: ['WorkspaceId'],
      suggestedModel: 'wan3.0-video',
      verification: { status: 'documented', source: 'https://help.aliyun.com/y' },
      verifiedAt: undefined,
    }),
  ]
  function page(routes: Parameters<typeof fakeServer>[0] = {}) {
    const server = fakeServer({
      'GET /api/providers': () => ({ items: [] }),
      'GET /api/settings': () => ({ activeProviders: {}, cost: {} }),
      'GET /api/projects': () => ({ items: [] }),
      'GET /api/presets': () => ({ items: presets }),
      ...routes,
    })
    const view = renderApp(<ProvidersPage />, { client: server.client })
    return { ...view, server }
  }
  const openCatalog = async () => {
    const section = await screen.findByRole('region', { name: /图生视频/ })
    await userEvent.click(within(section).getByRole('button', { name: '添加服务商' }))
    return screen.findByRole('dialog', { name: '添加服务商' })
  }

  it('shows vendor groups, region, verification status and the known limitations', async () => {
    page()
    const dialog = await openCatalog()
    const groups = await within(dialog).findAllByRole('region')
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual([
      'BytePlus',
      'Kling',
      'Alibaba Cloud',
    ])
    const bp = within(dialog).getByRole('button', { name: /BytePlus Seedance/ })
    expect(bp).toHaveTextContent('国际站')
    expect(bp).toHaveTextContent('按官方文档接入，未实测')
    expect(within(dialog).getByRole('button', { name: /Kling 4.0/ })).toHaveTextContent('国内站')
    // the limitations are one click away, in the provider's own words
    const summary = within(dialog).getByText('已知限制（2 条）')
    await userEvent.click(summary)
    expect(within(dialog).getByText('Real human faces are refused')).toBeInTheDocument()
    expect(within(dialog).queryByText('已知限制（0 条）')).toBeNull()
  })

  it('a preset with a placeholder in the host is created in one call with the full address', async () => {
    const { server } = page({
      'POST /api/providers/from-preset': () => makeKeyProvider({ id: 'prov_new', kind: 'video' }),
      'GET /api/providers/prov_new/capability': () => makeCapabilityView(),
    })
    const dialog = await openCatalog()
    await userEvent.click(within(dialog).getByRole('button', { name: /Wan 3.0/ }))
    const fill = await screen.findByRole('dialog', { name: /添加「Wan 3.0/ })
    await userEvent.type(within(fill).getByRole('textbox', { name: /WorkspaceId/ }), 'ws-42')
    await userEvent.click(within(fill).getByRole('button', { name: '添加' }))
    await waitFor(() =>
      expect(server.calls.some((c) => c.path === '/api/providers/from-preset')).toBe(true),
    )
    expect(server.calls.find((c) => c.path === '/api/providers/from-preset')?.body).toEqual({
      presetId: 'aliyun-wan3-cn',
      baseUrl: 'https://ws-42.dashscope.aliyuncs.com/api/v1',
    })
  })
})

describe('video providers’ own error codes', () => {
  it.each([
    ['KLING_1101', '服务商账号欠费，或者资源包用完了'],
    ['KLING_1102', '服务商账号欠费，或者资源包用完了'],
    ['Arrearage', '服务商账号欠费，或者资源包用完了'],
    ['KLING_1103', '服务商没有接受这个 Key'],
    ['InvalidApiKey', '服务商没有接受这个 Key'],
    ['KLING_1301', '被服务商的内容审核拦下了'],
    ['DataInspectionFailed', '被服务商的内容审核拦下了'],
    ['KLING_1302', '请求太频繁'],
    ['KLING_1303', '请求太频繁'],
    ['Throttling.RateQuota', '请求太频繁'],
    ['InputImageSensitiveContentDetected.PrivacyInformation', '这个模型不接受含真人人脸的图片'],
    ['TASK_EXPIRED', '服务商那边的任务已经过期'],
    ['TASK_CANCELLED', '任务在服务商那边被取消了'],
    ['TASK_UNKNOWN', '服务商不认识这个任务了'],
    ['FIRST_FRAME_REQUIRED', '必须有镜头图作为首帧'],
  ])('%s is explained, with the next step', async (code, title) => {
    const server = fakeServer({})
    render(
      <ApiContext.Provider value={server.client}>
        <MemoryRouter>
          <ProviderErrorNotice code={code} />
        </MemoryRouter>
      </ApiContext.Provider>,
    )
    expect(screen.getByTestId('provider-error')).toHaveTextContent(title)
  })
  it('an unknown Kling code keeps the generic failure text', () => {
    expect(providerErrorOf('KLING_9999')).toBeUndefined()
  })
  it('every explanation exists in all three languages', () => {
    for (const code of [
      'VIDEO_FACE_REJECTED',
      'CONTENT_REJECTED',
      'BALANCE_INSUFFICIENT',
      'TASK_EXPIRED',
      'TASK_CANCELLED',
      'TASK_UNKNOWN',
      'FIRST_FRAME_REQUIRED',
    ])
      for (const dict of [zh, zhTW, en]) {
        const e = (
          dict.providerErrors as unknown as Record<string, { title: string; body: string }>
        )[code]
        expect(e?.title, code).toBeTruthy()
        expect(e?.body, code).toBeTruthy()
      }
  })
})

// ---------------------------------------------------------------- the reference-image switch

const candidates: BatchCandidate[] = [1, 2].map((i) => ({
  shotId: `s${i}`,
  index: i,
  label: `镜头 0${i} · 回廊`,
  target: { kind: 'shot_video', shotId: `s${i}` },
}))

const plan = (over: Partial<VideoPlan> = {}): VideoPlan => ({
  mode: 'i2v',
  refsRequested: false,
  frame: 'strict_first_frame',
  ifRefsOn: 'frame_as_reference',
  referenceCount: 0,
  droppedReferences: 0,
  firstFrameWithRefs: 'unsupported',
  refImages: 'supported',
  ...over,
})

/** A model-specific pre-flight: what the answer is depends on whether the request asks for references. */
function openDialog(
  answer: (refs: boolean, shotId: string) => ReturnType<typeof makeVerdict>,
  extra: Parameters<typeof fakeServer>[0] = {},
  kind: 'shot_video' | 'shot_image' = 'shot_video',
) {
  const server = fakeServer({
    'GET /api/settings': () => ({
      activeProviders: { video: 'prov_v', image: 'prov_v' },
      cost: {},
    }),
    'GET /api/providers': () => ({ items: [makeProvider()] }),
    'GET /api/providers/prov_v/capability': () => makeCapabilityView('unsupported'),
    'POST /api/projects/proj_1/preflight': ({ body }) => {
      const items = (body as { items: GenerateItem[] }).items
      return makePreflight(
        items.map((it) => {
          const shotId = (it.target as { shotId: string }).shotId
          return answer(Boolean(it.videoRefs), shotId)
        }),
      )
    },
    'POST /api/projects/proj_1/generate': ({ body }) => {
      const items = (body as { items: GenerateItem[] }).items
      return {
        requested: [],
        succeeded: items.map((_, i) => ({ targetId: `t${i}`, jobId: `j${i}`, deduped: false })),
        failed: [],
        blocked: [],
        admission: makePreflight([]),
      }
    },
    ...extra,
  })
  const view = renderApp(
    <BatchConfirmDialog
      projectId="proj_1"
      episodeNumber={1}
      aspect="9:16"
      kind={kind}
      candidates={candidates}
      assets={new Map()}
      onClose={() => {}}
    />,
    { client: server.client },
  )
  return { ...view, server }
}
const vid = (
  shotId: string,
  video: VideoPlan,
  patch: Partial<ReturnType<typeof makeVerdict>> = {},
) => makeVerdict(`shot_video:${shotId}`, { video, ...patch })
const preflightBodies = (server: ReturnType<typeof fakeServer>) =>
  server.calls
    .filter((c) => c.path === '/api/projects/proj_1/preflight')
    .map((c) => (c.body as { items: GenerateItem[] }).items)

describe('reference images for video: the three kinds of model', () => {
  it('first frame and references are exclusive (Seedance, Wan 3.0): says so before anything is confirmed, then shows the shot image as reference no. 1', async () => {
    const { server } = openDialog((refs, id) =>
      refs
        ? vid(
            id,
            plan({
              refsRequested: true,
              frame: 'as_reference',
              referenceCount: 4,
              droppedReferences: 1,
            }),
            {
              warnings: [
                { code: 'FIRST_FRAME_REPLACED_BY_REFERENCE', message: 'x' },
                { code: 'REFS_TRIMMED', message: 'x' },
              ],
            },
          )
        : vid(id, plan()),
    )
    const sw = await screen.findByRole('switch', { name: '用角色设定图作参考' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    // off: what it does, what it costs, and what would happen — already visible
    expect(screen.getByText(/作为参考图和镜头一起交给视频模型/)).toBeInTheDocument()
    expect(
      screen.getByText('开启后，这个模型会放弃严格的首帧：镜头图只作为第 1 张参考图'),
    ).toBeInTheDocument()
    expect(server.calls.some((c) => c.path.endsWith('/generate'))).toBe(false)
    expect(screen.queryByTestId('video-plan')).toBeNull()

    await userEvent.click(sw)
    await waitFor(() =>
      expect(
        preflightBodies(server)
          .at(-1)
          ?.every((i) => i.videoRefs === true),
      ).toBe(true),
    )
    const lines = await screen.findAllByTestId('video-plan')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toHaveTextContent('放弃严格首帧：镜头图作为第 1 张参考图')
    expect(lines[0]).toHaveTextContent('共 4 张参考图')
    expect(lines[0]).toHaveTextContent('超过模型的上限，舍弃了 1 张')
    // the known gap is stated where the switch is
    expect(screen.getByText(/之后换了角色设定图，不会被自动标成“已过期”/)).toBeInTheDocument()
    // shown next to the shot, not repeated in the general warnings
    expect(screen.queryByText(/参考图超过了模型的上限/)).toBeNull()
    expect(
      screen.queryByText('开启参考图后，这个模型放弃严格的首帧：镜头图只作为第 1 张参考图'),
    ).toBeNull()

    await userEvent.click(await screen.findByRole('button', { name: /确认并加入队列/ }))
    await waitFor(() => expect(server.calls.some((c) => c.path.endsWith('/generate'))).toBe(true))
    const sent = server.calls.find((c) => c.path.endsWith('/generate'))!.body as {
      items: GenerateItem[]
    }
    expect(sent.items.every((i) => i.videoRefs === true)).toBe(true)
  })

  it('switch off: nothing about references is sent', async () => {
    const { server } = openDialog((_r, id) => vid(id, plan()))
    await screen.findByRole('switch', { name: '用角色设定图作参考' })
    await userEvent.click(await screen.findByRole('button', { name: /确认并加入队列/ }))
    await waitFor(() => expect(server.calls.some((c) => c.path.endsWith('/generate'))).toBe(true))
    const sent = server.calls.find((c) => c.path.endsWith('/generate'))!.body as { items: object[] }
    expect(sent.items.every((i) => !('videoRefs' in i))).toBe(true)
    expect(
      preflightBodies(server)
        .flat()
        .every((i) => !('videoRefs' in i)),
    ).toBe(true)
  })

  it('first frame and references can go together (Kling): the first frame stays, the combination needs confirming', async () => {
    const { server } = openDialog((refs, id) =>
      refs
        ? vid(
            id,
            plan({
              refsRequested: true,
              frame: 'with_references',
              ifRefsOn: 'frame_with_references',
              firstFrameWithRefs: 'unverified',
              referenceCount: 3,
            }),
            {
              status: 'needs_confirmation',
              unverified: [
                {
                  key: 'firstFrameWithRefs',
                  code: 'FRAME_WITH_REFS_UNSUPPORTED',
                  message: 'x',
                  confirmed: false,
                },
              ],
              reasons: [{ code: 'FRAME_WITH_REFS_UNSUPPORTED', message: 'x' }],
            },
          )
        : vid(id, plan({ ifRefsOn: 'frame_with_references', firstFrameWithRefs: 'unverified' })),
    )
    const sw = await screen.findByRole('switch', { name: '用角色设定图作参考' })
    expect(
      screen.getByText('首帧保留，参考图另发（这个组合没验证过，需要你确认）'),
    ).toBeInTheDocument()
    await userEvent.click(sw)
    const lines = await screen.findAllByTestId('video-plan')
    expect(lines[0]).toHaveTextContent('保持严格首帧，并另发参考图')
    expect(await screen.findByText('服务商没有验证过首帧和参考图能不能同时用')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /确认并加入队列/ })).toBeDisabled()
    void server
  })

  it('a model without reference images: the switch is off and cannot be turned on, and the text says what to do', async () => {
    const { server } = openDialog((_r, id) =>
      vid(id, plan({ ifRefsOn: 'not_available', refImages: 'unsupported' })),
    )
    const sw = await screen.findByRole('switch', { name: '用角色设定图作参考' })
    expect(sw).toBeDisabled()
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(
      screen.getByText(/这个模型不支持参考图，不能开启。换一个支持参考图的视频模型再试/),
    ).toBeInTheDocument()
    await userEvent.click(sw)
    expect(
      preflightBodies(server)
        .flat()
        .every((i) => !('videoRefs' in i)),
    ).toBe(true)
  })

  it('references requested of a model that cannot take them is a block with a way out', async () => {
    openDialog((refs, id) =>
      refs
        ? vid(
            id,
            plan({
              refsRequested: true,
              ifRefsOn: 'frame_with_references',
              refImages: 'unsupported',
            }),
            {
              status: 'blocked',
              reasons: [{ code: 'REFERENCE_NOT_SUPPORTED', message: 'x' }],
            },
          )
        : vid(id, plan({ ifRefsOn: 'frame_with_references' })),
    )
    await userEvent.click(await screen.findByRole('switch', { name: '用角色设定图作参考' }))
    expect(await screen.findByText('整批不会运行')).toBeInTheDocument()
    expect(
      (await screen.findAllByText(/当前视频模型不支持参考图，不能开启/)).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText(/关掉这个开关改用首帧，或者换一个支持参考图的视频模型/).length,
    ).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /确认并加入队列/ })).toBeDisabled()
    // turning it off again clears the block
    await userEvent.click(screen.getByRole('switch', { name: '用角色设定图作参考' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /确认并加入队列/ })).toBeEnabled(),
    )
  })

  it('references on but no usable sheets: says it is generated from the strict first frame', async () => {
    openDialog((refs, id) =>
      refs
        ? vid(id, plan({ refsRequested: true, frame: 'strict_first_frame' }), {
            warnings: [{ code: 'VIDEO_REFS_EMPTY', message: 'x' }],
          })
        : vid(id, plan()),
    )
    await userEvent.click(await screen.findByRole('switch', { name: '用角色设定图作参考' }))
    const lines = await screen.findAllByTestId('video-plan')
    expect(lines[0]).toHaveTextContent('没有可用的设定图，按严格首帧生成')
  })

  it('a model that cannot switch its own audio off: the warning is shown before confirming', async () => {
    openDialog((_r, id) =>
      vid(id, plan(), { warnings: [{ code: 'AUDIO_NOT_DISABLEABLE', message: 'x' }] }),
    )
    expect(
      await screen.findByText(/这个模型关不掉自带的声音：加入时间线时默认静音，可以在时间线上调高/),
    ).toBeInTheDocument()
  })

  it('the switch exists for video only', async () => {
    openDialog((_r, id) => makeVerdict(`shot_image:${id}`), {}, 'shot_image')
    await screen.findByText(/共生成 2 项/)
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('English and Traditional Chinese have the words', async () => {
    for (const [locale, name, text] of [
      [
        'en',
        'Use character sheets as references',
        'With references on, this model gives up the strict first frame',
      ],
      ['zh-TW', '用角色設定圖作參考', '開啟後，這個模型會放棄嚴格的首幀'],
    ] as const) {
      await switchLocale(locale)
      const view = openDialog((_r, id) => vid(id, plan()))
      expect(await screen.findByRole('switch', { name })).toBeInTheDocument()
      expect(screen.getByText(new RegExp(text))).toBeInTheDocument()
      view.unmount()
    }
  })
})

describe('prices: an unpriced run is never shown as zero', () => {
  it('says it cannot estimate and counts the unpriced items', async () => {
    openDialog((_r, id) => vid(id, plan(), { estimate: { priced: false, reason: 'no price' } }))
    await screen.findByRole('switch', { name: '用角色设定图作参考' })
    expect(screen.getByTestId('cost-headline')).toHaveTextContent('无法估算')
    expect(screen.getByTestId('cost-headline').textContent).not.toMatch(/0/)
  })
})

// ---------------------------------------------------------------- versions that used references

describe('a video version made with references', () => {
  const slot = (): MediaSlot => {
    const base = slotWith('video', 2)
    const [a, b] = base.versions
    return {
      currentVersionId: b!.id,
      versions: [
        a!,
        {
          ...b!,
          usedReferences: {
            frame: 'as_reference',
            references: [
              { role: 'start_frame' },
              { role: 'character', assetName: '林夏', variantName: '冬装' },
              { role: 'location', assetName: '老茶馆' },
            ],
            trimmed: 1,
          },
        },
      ],
    }
  }
  const strip = () =>
    renderApp(
      <VersionStrip
        projectId="proj_1"
        imageSlot={{ currentVersionId: null, versions: [] } as unknown as MediaSlot}
        videoSlot={slot()}
        onSetCurrent={() => {}}
      />,
      { client: fakeServer({}).client },
    )

  it('names the references in the order they were sent, how the shot image was used, what was left out, and the known gap', async () => {
    strip()
    expect(screen.getByTestId('video-refs-used')).toHaveTextContent('用了参考图')
    await userEvent.click(screen.getByRole('button', { name: '版本历史' }))
    const box = screen.getByTestId('video-refs-versions')
    expect(box).toHaveTextContent('用了参考图：镜头图、林夏 (冬装)、老茶馆')
    expect(box).toHaveTextContent('镜头图作为第 1 张参考图，没有严格首帧')
    expect(box).toHaveTextContent('另有 1 张超过上限，没有带上')
    expect(box).toHaveTextContent('v2')
    expect(box).toHaveTextContent('不会被自动标成“已过期”')
  })

  it('a video without references says nothing about them', async () => {
    renderApp(
      <VersionStrip
        projectId="proj_1"
        imageSlot={{ currentVersionId: null, versions: [] } as unknown as MediaSlot}
        videoSlot={slotWith('video', 2)}
        onSetCurrent={() => {}}
      />,
      { client: fakeServer({}).client },
    )
    expect(screen.queryByTestId('video-refs-used')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '版本历史' }))
    expect(screen.queryByTestId('video-refs-versions')).toBeNull()
  })
})

// ---------------------------------------------------------------- clips that start silent

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

describe('a clip whose own audio is muted', () => {
  it('is marked on the timeline and explained in the inspector, where the volume can be raised', async () => {
    const timeline = makeTimeline()
    timeline.placement.clips[0] = placedClip('clip_1', 'shot_1', 0, { sourceVolume: 0 })
    timeline.revision.content.clips[0]!.sourceVolume = 0
    const shots = [
      makeShot({ id: 'shot_1', image: slotWith('image'), video: slotWith('video') }),
      makeShot({ id: 'shot_2', image: slotWith('image'), video: slotWith('video') }),
    ]
    const server = fakeServer({
      'GET /api/projects/proj_1': () => project,
      'GET /api/episodes/ep_1': () => makeEpisodeDetail(shots),
      'GET /api/episodes/ep_1/timeline': () => timeline,
      'GET /api/episodes/ep_1/artifacts': () => ({ items: [] }),
      'GET /api/projects/proj_1/assets': () => ({ items: [] }),
      'GET /api/jobs': () => ({ items: [] }),
      'GET /api/system': () => makeSystem(),
      'GET /api/settings': () => ({ activeProviders: {}, cost: {} }),
    })
    renderApp(
      <Routes>
        <Route path="/projects/:projectId/episodes/:episodeId/compose" element={<ComposePage />} />
      </Routes>,
      { client: server.client, route: '/projects/proj_1/episodes/ep_1/compose' },
    )
    const muted = await screen.findByRole('button', { name: /片段 c1.*原声静音/ })
    expect(muted).toHaveTextContent('原声静音')
    // the other clip (volume 0.3) is not marked
    expect(screen.getByRole('button', { name: /片段 c2/ }).getAttribute('aria-label')).not.toMatch(
      /原声静音/,
    )
    await userEvent.click(muted)
    expect(await screen.findByText(/这个片段的原声现在是静音的（音量 0）/)).toBeInTheDocument()
    expect(screen.getByText(/有的视频模型关不掉自带的声音/)).toBeInTheDocument()
  })
})

describe('the timeline preview uses the volume on the timeline', () => {
  it('sets the playing clip’s volume, and follows a change made while it is open', async () => {
    const timeline = makeTimeline()
    const server = fakeServer({})
    const at = (v: number) => ({
      ...timeline.placement,
      clips: timeline.placement.clips.map((c, i) => (i === 0 ? { ...c, sourceVolume: v } : c)),
    })
    const props = {
      projectId: 'proj_1',
      videoPath: () => 'videos/x.mp4',
      narrationPath: () => undefined,
      aspect: '9:16' as const,
    }
    const view = renderApp(<PreviewPlayer {...props} placement={at(0)} />, {
      client: server.client,
    })
    const video = () => view.container.querySelector('video')!
    expect(video().volume).toBe(0)
    view.rerender(<PreviewPlayer {...props} placement={at(0.6)} />)
    await waitFor(() => expect(video().volume).toBeCloseTo(0.6))
    expect(video().muted).toBe(false)
  })
})

// ---------------------------------------------------------------- small fixes from the last review

describe('review leftovers', () => {
  const pageWith = (providers: unknown[], presets: unknown[] = []) => {
    const server = fakeServer({
      'GET /api/providers': () => ({ items: providers }),
      'GET /api/settings': () => ({ activeProviders: {}, cost: {} }),
      'GET /api/projects': () => ({ items: [] }),
      'GET /api/presets': () => ({ items: presets }),
      ...Object.fromEntries(
        (providers as { id: string }[]).map((p) => [
          `GET /api/providers/${p.id}/capability`,
          () => makeCapabilityView(),
        ]),
      ),
    })
    return renderApp(<ProvidersPage />, { client: server.client })
  }
  const expand = async (name: string) => {
    const card = await screen.findByRole('article', { name })
    await userEvent.click(within(card).getByRole('button', { name: /展开/ }))
    return card
  }

  it('a preset that only lacks a model puts the focus in the model field, not on Close', async () => {
    pageWith(
      [],
      [
        makePreset({
          id: 'lm',
          label: 'LM Studio',
          vendor: { id: 'lmstudio', label: 'LM Studio' },
          region: 'local',
          baseUrl: 'http://127.0.0.1:1234/v1',
          suggestedModel: '',
          auth: { type: 'none' },
          verification: { status: 'documented', source: 'https://lmstudio.ai/docs' },
          verifiedAt: undefined,
        }),
      ],
    )
    const section = await screen.findByRole('region', { name: /大模型/ })
    await userEvent.click(within(section).getByRole('button', { name: '添加服务商' }))
    const dialog = await screen.findByRole('dialog', { name: '添加服务商' })
    await userEvent.click(await within(dialog).findByRole('button', { name: /LM Studio/ }))
    const fill = await screen.findByRole('dialog', { name: /添加「LM Studio」/ })
    const model = within(fill).getByRole('textbox', { name: /模型/ })
    await waitFor(() => expect(model).toHaveFocus())
    expect(within(fill).getByRole('button', { name: '关闭' })).not.toHaveFocus()
  })

  it('the advanced-settings text fits the kind of provider and has no stray space after a Chinese full stop', async () => {
    pageWith([
      makeKeyProvider(),
      makeKeyProvider({ id: 'prov_v', label: 'Kling', kind: 'video', protocol: 'kling-contents' }),
      makeKeyProvider({ id: 'prov_t', label: 'Speech', kind: 'tts', protocol: 'openai-tts' }),
    ])
    const text = await expand('DeepSeek')
    // a text provider keeps the Anthropic example
    expect(text).toHaveTextContent('anthropic-workspace-id')
    for (const name of ['Kling', 'Speech']) {
      const card = await expand(name)
      const adv = within(card).getByText('高级设置').closest('details')!
      expect(adv).not.toHaveTextContent('Anthropic')
      expect(adv).not.toHaveTextContent('OpenAI')
      expect(adv).not.toHaveTextContent('anthropic-workspace-id')
      expect(adv).toHaveTextContent('这个协议只读额外请求头')
      expect(adv).not.toHaveTextContent('JSON 输出方式')
    }
    for (const c of document.querySelectorAll('details'))
      expect(c.textContent).not.toMatch(/。\s+[^\s]/)
  })

  it('a verification source that is not an http(s) address is plain text, not a link', async () => {
    pageWith([
      makeKeyProvider({
        id: 'prov_a',
        label: 'A',
        verification: { status: 'documented', source: 'javascript:alert(1)' },
      }),
      makeKeyProvider({
        id: 'prov_b',
        label: 'B',
        verification: { status: 'documented', source: 'https://docs.example.com/x' },
      }),
    ])
    const a = await expand('A')
    expect(within(a).queryByRole('link')).toBeNull()
    expect(a).toHaveTextContent('javascript:alert(1)')
    const b = await expand('B')
    expect(within(b).getByRole('link', { name: 'https://docs.example.com/x' })).toHaveAttribute(
      'href',
      'https://docs.example.com/x',
    )
  })

  it('Traditional Chinese uses 文字, 帳 and 儲值 everywhere, not the Mainland 文本, 賬 and 充值', () => {
    const text = JSON.stringify(zhTW)
    for (const wrong of ['文本', '賬', '充值']) expect(text, wrong).not.toContain(wrong)
    expect(text).toContain('文字')
    expect(text).toContain('帳')
    expect(text).toContain('儲值')
  })
})
