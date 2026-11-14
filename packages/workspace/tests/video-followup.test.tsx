import { Route, Routes } from 'react-router'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { GenerateItem, TimelineView, VideoPlan } from '@dramai/api'
import { ComposePage } from '@/features/compose/ComposePage'
import { RevisionList } from '@/features/compose/RevisionList'
import { keysForChange } from '@/data/events'
import { BatchConfirmDialog } from '@/features/storyboard/BatchConfirmDialog'
import type { BatchCandidate } from '@/features/storyboard/batch-model'
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
import { renderApp, useLocale } from './render'

const switchLocale = useLocale
beforeEach(async () => {
  await useLocale('zh-CN')
})

// ------------------------------------------------------------ the reference list in the confirm dialog

const plan = (over: Partial<VideoPlan> = {}): VideoPlan => ({
  mode: 'omni_ref',
  refsRequested: true,
  frame: 'as_reference',
  ifRefsOn: 'frame_as_reference',
  referenceCount: 0,
  droppedReferences: 0,
  firstFrameWithRefs: 'unsupported',
  refImages: 'supported',
  ...over,
})
const names = {
  start: { order: 1, role: 'start_frame' as const },
  lin: { order: 2, role: 'character' as const, assetName: '林夏', variantName: '冬装' },
  tea: { order: 3, role: 'location' as const, assetName: '老茶馆' },
}

function open(plans: Record<string, VideoPlan>, count = Object.keys(plans).length) {
  const candidates: BatchCandidate[] = Array.from({ length: count }, (_, i) => ({
    shotId: `s${i + 1}`,
    index: i + 1,
    label: `镜头 0${i + 1}`,
    target: { kind: 'shot_video', shotId: `s${i + 1}` },
  }))
  const server = fakeServer({
    'GET /api/settings': () => ({ activeProviders: { video: 'prov_v' }, cost: {} }),
    'GET /api/providers': () => ({ items: [makeProvider()] }),
    'GET /api/providers/prov_v/capability': () => makeCapabilityView(),
    'POST /api/projects/proj_1/preflight': ({ body }) =>
      makePreflight(
        (body as { items: GenerateItem[] }).items.map((it) => {
          const id = (it.target as { shotId: string }).shotId
          return makeVerdict(`shot_video:${id}`, { video: plans[id] ?? Object.values(plans)[0]! })
        }),
      ),
  })
  renderApp(
    <BatchConfirmDialog
      projectId="proj_1"
      episodeNumber={1}
      aspect="9:16"
      kind="shot_video"
      candidates={candidates}
      assets={new Map()}
      onClose={() => {}}
    />,
    { client: server.client },
  )
  return server
}
const turnOn = async () =>
  userEvent.click(await screen.findByRole('switch', { name: '用角色设定图作参考' }))

describe('the reference list per shot', () => {
  it('the shot image becomes reference 1 and two assets follow: a short summary, the full ordered list one click away', async () => {
    open({
      s1: plan({
        referenceCount: 3,
        references: [names.start, names.lin, names.tea],
        dropped: [],
        startFrame: { use: 'reference' },
      }),
    })
    await turnOn()
    const list = await screen.findByTestId('video-plan-list')
    expect(list).not.toHaveAttribute('open')
    expect(within(list).getByText(/会带上/)).toHaveTextContent(
      '会带上：镜头图、林夏 (冬装)、老茶馆，共 3 张',
    )
    await userEvent.click(within(list).getByText(/会带上/))
    const items = within(list)
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(items).toEqual(['镜头图', '林夏 (冬装)', '老茶馆'])
    expect(within(list).queryByText(/严格首帧/)).toBeNull()
  })

  it('strict first frame plus assets: the shot image is said to be the first frame, not a reference', async () => {
    open({
      s1: plan({
        frame: 'with_references',
        ifRefsOn: 'frame_with_references',
        firstFrameWithRefs: 'unverified',
        referenceCount: 2,
        references: [
          { order: 1, role: 'character', assetName: '林夏' },
          { order: 2, role: 'location', assetName: '老茶馆' },
        ],
        dropped: [],
        startFrame: { use: 'first_frame' },
      }),
    })
    await turnOn()
    const list = await screen.findByTestId('video-plan-list')
    await userEvent.click(within(list).getByText(/会带上/))
    expect(within(list).getByText('镜头图：作为严格首帧（不在下面的参考图里）')).toBeInTheDocument()
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['林夏', '老茶馆'])
  })

  it('references left out are listed with the reason', async () => {
    open({
      s1: plan({
        referenceCount: 2,
        droppedReferences: 1,
        references: [names.start, names.lin],
        dropped: [{ role: 'location', assetName: '老茶馆', reason: 'over_limit' }],
        startFrame: { use: 'reference' },
      }),
    })
    await turnOn()
    const line = await screen.findByTestId('video-plan')
    expect(line).toHaveTextContent('超过模型的上限，舍弃了 1 张')
    await userEvent.click(within(line).getByText(/会带上/))
    expect(within(line).getByText('舍弃了：')).toBeInTheDocument()
    expect(within(line).getByText('老茶馆（超过模型的参考图上限）')).toBeInTheDocument()
  })

  it('no usable sheets: says it is generated from the first frame, with no empty list', async () => {
    open({ s1: plan({ frame: 'strict_first_frame', references: [], dropped: [] }) })
    await turnOn()
    const line = await screen.findByTestId('video-plan')
    expect(line).toHaveTextContent('没有可用的设定图，按严格首帧生成')
    expect(within(line).queryByTestId('video-plan-list')).toBeNull()
  })

  it('a long batch stays short: every shot’s list is collapsed until opened', async () => {
    const p = plan({
      referenceCount: 3,
      references: [names.start, names.lin, names.tea],
      dropped: [],
      startFrame: { use: 'reference' },
    })
    open({ s1: p, s2: p, s3: p, s4: p, s5: p, s6: p })
    await turnOn()
    const lists = await screen.findAllByTestId('video-plan-list')
    expect(lists).toHaveLength(6)
    for (const l of lists) expect(l).not.toHaveAttribute('open')
  })

  it('English', async () => {
    await switchLocale('en')
    open({
      s1: plan({
        referenceCount: 2,
        droppedReferences: 1,
        references: [names.start, names.lin],
        dropped: [{ role: 'location', assetName: 'Old teahouse', reason: 'over_limit' }],
        startFrame: { use: 'reference' },
      }),
    })
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Use character sheets as references' }),
    )
    const list = await screen.findByTestId('video-plan-list')
    expect(within(list).getByText(/Will send/)).toHaveTextContent(
      'Will send: Shot image, 林夏 (冬装), 2 in all',
    )
    await userEvent.click(within(list).getByText(/Will send/))
    expect(screen.getByText('Old teahouse (over the model’s reference limit)')).toBeInTheDocument()
  })
})

// ------------------------------------------------------------ revision history

describe('system revisions are described in the interface language', () => {
  const view = (revisions: Partial<TimelineView['revisions'][number]>[]) => {
    const tl = makeTimeline({ head: revisions.length })
    tl.revisions = revisions.map((r, i) => ({
      number: i + 1,
      author: { kind: 'creator' as const },
      summary: '某个中文摘要',
      createdAt: 1,
      ...r,
    })) as TimelineView['revisions']
    return tl
  }
  const render = (tl: TimelineView) =>
    renderApp(<RevisionList view={tl} onRollback={() => {}} />, { client: fakeServer({}).client })

  it('the automatic mute: a localized explanation with the clips changed, from the system, not an agent edit', () => {
    render(
      view([
        { number: 1 },
        {
          number: 2,
          author: { kind: 'agent' },
          summary: '默认音量：服务端写的',
          changedClipIds: ['clip_1', 'clip_2'],
          reason: 'native_audio_default',
        },
      ]),
    )
    const row = screen
      .getByText(/这些片段的模型关不掉自带的声音，原声默认静音，可以调高：c1、c2/)
      .closest('li')!
    expect(row).toHaveTextContent('系统（自动）')
    expect(row).not.toHaveTextContent('智能体')
    expect(screen.queryByText('默认音量：服务端写的')).toBeNull()
  })

  it('without the clip list it still explains', () => {
    render(
      view([
        { number: 1 },
        { number: 2, author: { kind: 'agent' }, reason: 'native_audio_default' },
      ]),
    )
    expect(
      screen.getByText('有的片段的模型关不掉自带的声音，这些片段的原声默认静音，可以调高'),
    ).toBeInTheDocument()
  })

  it('the first revision and a rollback are localized; an agent edit without a reason keeps its summary and author', () => {
    render(
      view([
        { number: 1, summary: '初始时间线' },
        { number: 2, author: { kind: 'agent' }, summary: 'agent 调整了顺序' },
        { number: 3, summary: '回滚到修订 1', restoredFrom: 1 },
      ]),
    )
    expect(screen.getByText('初始时间线')).toBeInTheDocument()
    // said once: the title carries it, the note line does not repeat it
    expect(screen.getAllByText(/回滚到修订 1/)).toHaveLength(1)
    expect(screen.queryByText(/回滚自修订/)).toBeNull()
    const agent = screen.getByText('agent 调整了顺序').closest('li')!
    expect(agent).toHaveTextContent('智能体')
  })

  it('English and Traditional Chinese: the mute explanation, and a rollback said once in its title', async () => {
    for (const [locale, text, rolled, note] of [
      [
        'en',
        'The model of these clips can’t turn its own audio off, so their audio starts muted; you can raise it: c1',
        /rolled back to revision 1/i,
        /restored from|rolled back from/i,
      ],
      [
        'zh-TW',
        '這些片段的模型關不掉自帶的聲音，原聲預設靜音，可以調高：c1',
        '回滾到修訂 1',
        /回滾自/,
      ],
    ] as const) {
      await switchLocale(locale)
      const { unmount } = render(
        view([
          { number: 1, summary: '初始时间线', reason: 'initial' },
          {
            number: 2,
            author: { kind: 'agent' },
            changedClipIds: ['clip_1'],
            reason: 'native_audio_default',
          },
          { number: 3, summary: '回滚到修订 1', restoredFrom: 1, reason: 'rollback' },
        ]),
      )
      expect(screen.getByText(text)).toBeInTheDocument()
      // the rollback is said once: the title carries it and the note line does not repeat it
      // (a substring match, so the title and the note line would both be counted)
      expect(screen.getAllByText(rolled)).toHaveLength(1)
      expect(screen.queryByText(note)).toBeNull()
      if (locale === 'en') expect(screen.getByText('Initial timeline')).toBeInTheDocument()
      unmount()
    }
  })

  it('reason codes decide the text: initial, sync_shots, rollback; a person’s edit keeps its summary', () => {
    render(
      view([
        { number: 1, summary: 'whatever', reason: 'initial' },
        { number: 2, summary: '同步镜头顺序', reason: 'sync_shots' },
        { number: 3, summary: '回滚到修订 1', restoredFrom: 1, reason: 'rollback' },
        { number: 4, summary: '我改了音量' },
      ]),
    )
    expect(screen.getByText('初始时间线')).toBeInTheDocument()
    expect(screen.getByText('同步镜头顺序').closest('li')).toHaveTextContent('系统（自动）')
    // a rollback is the person's own action, so it is attributed to them
    expect(screen.getByText('回滚到修订 1').closest('li')).toHaveTextContent('你')
    expect(screen.getByText('我改了音量').closest('li')).toHaveTextContent('你')
  })

  it('an old revision without a reason falls back to the first-revision and restoredFrom rules', () => {
    render(
      view([
        { number: 1, summary: '初始时间线' },
        { number: 2, summary: '随便', restoredFrom: 1 },
      ]),
    )
    expect(screen.getByText('初始时间线')).toBeInTheDocument()
    expect(screen.getByText('回滚到修订 1')).toBeInTheDocument()
  })

  it('a reason this version has never heard of shows the summary the server wrote', () => {
    render(
      view([
        { number: 1 },
        { number: 2, summary: '服务端写的新类型说明', reason: 'brand_new_reason' as never },
      ]),
    )
    const row = screen.getByText('服务端写的新类型说明').closest('li')!
    expect(row).toHaveTextContent('你')
  })
})

// ------------------------------------------------------------ timeline change events

describe('the timeline changed on the server (an automatic mute)', () => {
  it('a data.changed for the timeline refetches it', () => {
    const keys = keysForChange({
      type: 'data.changed',
      entity: 'timeline',
      ids: ['tl_1'],
      projectId: 'proj_1',
    } as never)
    expect(keys.some((k) => k[0] === 'timeline')).toBe(true)
  })

  const project = {
    schemaVersion: 1,
    id: 'proj_1',
    name: '清朝宫廷',
    aspectRatio: '9:16' as const,
    style: {
      source: 'none' as const,
      label: '',
      description: '',
      imageKeywords: '',
      expandedAt: 1,
    },
    narrationDelivery: 'tts' as const,
    episodeOrder: ['ep_1'],
    counters: { episode: 1, scene: 1, shot: 2, asset: 0, material: 0 },
    createdAt: 1,
    updatedAt: 1,
  }

  it('the new revision shows up, and what the user was typing in another clip is kept', async () => {
    let timeline = makeTimeline()
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
    const view = renderApp(
      <Routes>
        <Route path="/projects/:projectId/episodes/:episodeId/compose" element={<ComposePage />} />
      </Routes>,
      { client: server.client, route: '/projects/proj_1/episodes/ep_1/compose' },
    )
    await userEvent.click(await screen.findByRole('button', { name: /片段 c2/ }))
    const volume = await screen.findByLabelText('原声音量（0 到 1）')
    await userEvent.clear(volume)
    await userEvent.type(volume, '0.8') // typed, not saved yet

    // the server mutes clip 1 and adds revision 4
    const next = makeTimeline({ head: 4 })
    next.placement.clips[0] = placedClip('clip_1', 'shot_1', 0, { sourceVolume: 0 })
    next.revision.content.clips[0]!.sourceVolume = 0
    next.revisions[0] = {
      ...next.revisions[0]!,
      author: { kind: 'agent' },
      changedClipIds: ['clip_1'],
      reason: 'native_audio_default',
      summary: '默认音量：x',
    }
    timeline = next
    await view.queryClient.invalidateQueries({ queryKey: ['timeline'] })

    expect(await screen.findByRole('button', { name: /片段 c1.*原声静音/ })).toBeInTheDocument()
    await waitFor(() =>
      expect(
        screen.getByText(/这些片段的模型关不掉自带的声音，原声默认静音，可以调高：c1/),
      ).toBeInTheDocument(),
    )
    // the typed value in the other clip's field is still there
    expect(screen.getByLabelText('原声音量（0 到 1）')).toHaveValue('0.8')
  })
})
