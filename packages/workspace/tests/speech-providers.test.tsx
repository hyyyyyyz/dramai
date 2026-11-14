import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useContext, useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerateItem, Project } from '@dramai/api'
import { StoreContext } from '@/data/contexts'
import { BatchConfirmDialog } from '@/features/storyboard/BatchConfirmDialog'
import type { BatchCandidate } from '@/features/storyboard/batch-model'
import { ProjectSettingsDialog } from '@/features/overview/ProjectSettingsDialog'
import { TaskItem } from '@/features/jobs/TaskItem'
import { TaskPanel } from '@/features/jobs/TaskPanel'
import { workerErrorKind } from '@/features/jobs/job-model'
import { costHeadline, hasRange } from '@/features/storyboard/cost'
import { ProvidersPage } from '@/features/settings/ProvidersPage'
import { ALL_PROTOCOLS, PROTOCOLS_BY_KIND, kindOfProtocol } from '@/features/settings/protocols'
import {
  instructionWeight,
  speechInputSupport,
  voiceFit,
  voiceFormatProblem,
  voiceListKind,
  voiceMismatch,
} from '@/features/settings/voice-model'
import { voiceIssues } from '@/features/settings/voice-issues'
import en from '@/i18n/locales/en'
import zhTW from '@/i18n/locales/zh-TW'
import zh from '@/i18n/locales/zh-CN'
import { failedJob, fakeServer, makeJob } from './fixtures'
import { makeCapabilityView, makePreflight, makeProvider, makeVerdict } from './fixtures-production'
import { makeKeyProvider, makePreset } from './fixtures-providers'
import { renderApp, useLocale } from './render'

const switchLocale = useLocale
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
  vi.stubGlobal('localStorage', memoryStorage())
  await useLocale('zh-CN')
})
afterEach(() => vi.unstubAllGlobals())

// ------------------------------------------------------------------ speech capability fixtures

const voice = (id: string, label?: string, lang?: string) => ({
  id,
  ...(label ? { label } : {}),
  ...(lang ? { lang } : {}),
})
const OPENAI_VOICES = [voice('alloy', 'Alloy'), voice('echo', 'Echo'), voice('nova', 'Nova')]
const MINIMAX_VOICES = [
  voice('Chinese (Mandarin)_News_Anchor', '新闻主播', 'zh'),
  voice('male-qn-qingse', '青涩青年', 'zh'),
]

function speechCap(over: Record<string, unknown>) {
  const base = makeCapabilityView()
  return {
    ...base,
    capability: {
      ...base.capability,
      media: 'audio' as const,
      modes: { tts: 'supported' as const },
      ...over,
    },
  }
}
const closedCap = speechCap({
  voices: { support: 'supported', value: OPENAI_VOICES },
  defaultVoice: 'alloy',
  maxPromptChars: 4096,
})
const openCap = speechCap({
  voices: {
    support: 'unverified',
    value: MINIMAX_VOICES,
    note: '官方文档列出的常用音色，共 332 个，没有实测',
  },
  defaultVoice: 'Chinese (Mandarin)_News_Anchor',
  maxPromptChars: 9999,
})
const noVoicesCap = speechCap({ voices: { support: 'unsupported', value: [] } })

const ttsProvider = (patch: Record<string, unknown>) =>
  makeKeyProvider({ id: 'prov_tts', label: '配音', kind: 'tts', ...patch })
const project = (over: Partial<Project> = {}): Project =>
  ({
    schemaVersion: 1,
    id: 'proj_1',
    name: '清朝宫廷',
    aspectRatio: '9:16',
    style: { source: 'none', label: '', description: '', imageKeywords: '', expandedAt: 1 },
    narrationDelivery: 'tts',
    episodeOrder: [],
    counters: { episode: 0, scene: 0, shot: 0, asset: 0, material: 0 },
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }) as Project

// ------------------------------------------------------------------ the pure rules

describe('voice rules', () => {
  it('tells the three kinds of voice list apart', () => {
    expect(voiceListKind(closedCap.capability as never)).toBe('closed')
    expect(voiceListKind(openCap.capability as never)).toBe('open')
    expect(voiceListKind(noVoicesCap.capability as never)).toBe('none')
    expect(voiceListKind(undefined)).toBe('none')
  })
  it('a voice that is not on a closed list does not fit; on an open list it is only unlisted', () => {
    expect(voiceFit(closedCap.capability as never, 'alloy')).toBe('fine')
    expect(voiceFit(closedCap.capability as never, 'x')).toBe('not_in_list')
    expect(voiceFit(openCap.capability as never, 'x')).toBe('unlisted')
    expect(voiceFit(noVoicesCap.capability as never, 'x')).toBe('fine')
  })
  it('says whether a voice belongs to the previous provider or simply is not there', () => {
    const next = closedCap.capability as never
    const prev = openCap.capability as never
    expect(voiceMismatch(next, prev, 'male-qn-qingse')).toBe('from_another_service')
    expect(voiceMismatch(next, prev, 'nobody')).toBe('not_available')
    expect(voiceMismatch(next, prev, 'alloy')).toBeUndefined()
  })
  it('SiliconFlow wants model:voice, or a speech: address', () => {
    const url = 'https://api.siliconflow.cn/v1'
    const model = 'FunAudioLLM/CosyVoice2-0.5B'
    expect(voiceFormatProblem(url, model, 'alex')).toBe(true)
    expect(voiceFormatProblem(url, model, `${model}:alex`)).toBe(false)
    expect(voiceFormatProblem(url, model, 'speech:abc')).toBe(false)
    expect(voiceFormatProblem(url, model, '')).toBe(false)
    expect(voiceFormatProblem('https://api.openai.com/v1', 'gpt-4o-mini-tts', 'alloy')).toBe(false)
  })
  it('knows which models take a style instruction and a language hint', () => {
    expect(speechInputSupport('openai-tts', 'gpt-4o-mini-tts')).toEqual({
      instructions: true,
      language: false,
    })
    expect(speechInputSupport('openai-tts', 'tts-1')).toEqual({
      instructions: false,
      language: false,
    })
    expect(speechInputSupport('minimax-t2a', 'speech-2.8-hd')).toEqual({
      instructions: false,
      language: true,
    })
    expect(speechInputSupport('dashscope-cosyvoice', 'cosyvoice-v3-flash')).toEqual({
      instructions: true,
      language: true,
    })
  })
  it('counts a Chinese character as 2 in an instruction', () => {
    expect(instructionWeight('abc')).toBe(3)
    expect(instructionWeight('平静')).toBe(4)
  })
})

describe('the two new speech protocols', () => {
  it('are speech protocols with a name in every language', () => {
    for (const p of ['minimax-t2a', 'dashscope-cosyvoice'] as const) {
      expect(kindOfProtocol(p)).toBe('tts')
      expect(PROTOCOLS_BY_KIND.tts).toContain(p)
      expect(ALL_PROTOCOLS).toContain(p)
      for (const dict of [zh, zhTW, en])
        expect((dict.protocol as Record<string, string>)[p], p).toBeTruthy()
    }
  })
})

// ------------------------------------------------------------------ the catalog

describe('speech presets in the catalog', () => {
  const presets = [
    makePreset({
      id: 'openai-tts-key',
      kind: 'tts',
      label: 'OpenAI 语音',
      vendor: { id: 'openai', label: 'OpenAI' },
      region: 'global',
      protocol: 'openai-tts',
      baseUrl: 'https://api.openai.com/v1',
      suggestedModel: 'gpt-4o-mini-tts',
      verification: { status: 'documented', source: 'https://platform.openai.com/docs' },
      verifiedAt: undefined,
      knownLimitations: ['OpenAI 计划在 2027-01-06 关停 tts-1、tts-1-hd 和 gpt-4o-mini-tts'],
    }),
    makePreset({
      id: 'minimax-tts-cn',
      kind: 'tts',
      label: 'MiniMax 语音（国内）',
      vendor: { id: 'minimax', label: 'MiniMax' },
      region: 'cn',
      protocol: 'minimax-t2a',
      baseUrl: 'https://api.minimax.chat/v1',
      suggestedModel: 'speech-2.8-hd',
      verification: { status: 'documented', source: 'https://platform.minimaxi.com/doc' },
      verifiedAt: undefined,
    }),
  ]
  it('shows vendor, region, status, and the retirement date of the OpenAI models', async () => {
    const server = fakeServer({
      'GET /api/providers': () => ({ items: [] }),
      'GET /api/settings': () => ({ activeProviders: {}, cost: {} }),
      'GET /api/projects': () => ({ items: [] }),
      'GET /api/presets': () => ({ items: presets }),
    })
    renderApp(<ProvidersPage />, { client: server.client })
    const section = await screen.findByRole('region', { name: /配音/ })
    await userEvent.click(within(section).getByRole('button', { name: '添加服务商' }))
    const dialog = await screen.findByRole('dialog', { name: '添加服务商' })
    const groups = await within(dialog).findAllByRole('region')
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['OpenAI', 'MiniMax'])
    expect(within(dialog).getByRole('button', { name: /MiniMax 语音/ })).toHaveTextContent('国内站')
    expect(within(dialog).getByRole('button', { name: /OpenAI 语音/ })).toHaveTextContent(
      '按官方文档接入，未实测',
    )
    await userEvent.click(within(dialog).getAllByText(/已知限制/)[0]!)
    expect(within(dialog).getByText(/2027-01-06/)).toBeInTheDocument()
  })
  it('a configured provider card shows the same limitation', async () => {
    const provider = ttsProvider({ knownLimitations: ['OpenAI 计划在 2027-01-06 关停 tts-1'] })
    const server = fakeServer({
      'GET /api/providers': () => ({ items: [provider] }),
      'GET /api/settings': () => ({ activeProviders: {}, cost: {} }),
      'GET /api/projects': () => ({ items: [] }),
      'GET /api/presets': () => ({ items: [] }),
      'GET /api/providers/prov_tts/capability': () => closedCap,
    })
    renderApp(<ProvidersPage />, { client: server.client })
    const card = await screen.findByRole('article', { name: '配音' })
    await userEvent.click(within(card).getByRole('button', { name: /展开/ }))
    expect(await within(card).findByText(/2027-01-06/)).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ choosing the voice

function openSettings(opts: {
  cap: unknown
  provider?: Record<string, unknown>
  project?: Partial<Project>
}) {
  const provider = ttsProvider(
    opts.provider ?? { protocol: 'openai-tts', model: 'gpt-4o-mini-tts' },
  )
  const server = fakeServer({
    'GET /api/settings': () => ({ activeProviders: { tts: 'prov_tts' }, cost: {} }),
    'GET /api/providers': () => ({ items: [provider] }),
    'GET /api/providers/prov_tts/capability': () => opts.cap,
    'PATCH /api/projects/proj_1': ({ body }) => ({ ...project(opts.project), ...(body as object) }),
  })
  renderApp(<ProjectSettingsDialog project={project(opts.project)} onClose={() => {}} />, {
    client: server.client,
  })
  return server
}
const patchBody = (server: ReturnType<typeof fakeServer>) =>
  server.calls.find((c) => c.method === 'PATCH')?.body as { narrationVoice?: unknown }
const save = async (server: ReturnType<typeof fakeServer>) => {
  await userEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(server.calls.some((c) => c.method === 'PATCH')).toBe(true))
}

describe('choosing the narration voice', () => {
  it('closed list: only the listed voices, the default is named, nothing can be typed', async () => {
    const server = openSettings({ cap: closedCap })
    const select = await screen.findByRole('combobox', { name: '音色' })
    expect([...(select as HTMLSelectElement).options].map((o) => o.text)).toEqual([
      '默认（alloy）',
      'Alloy',
      'Echo',
      'Nova',
    ])
    expect(screen.getByText('这个型号只有清单里的音色，只能从里面选')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /手填/ })).toBeNull()
    expect(screen.getByText('不选就用这个型号的默认音色：alloy')).toBeInTheDocument()
    await userEvent.selectOptions(select, 'nova')
    await save(server)
    expect(patchBody(server).narrationVoice).toEqual({
      providerConfigId: 'prov_tts',
      voice: 'nova',
    })
  })

  it('open list: says only the common voices are listed, shows where the list comes from, and lets another be typed', async () => {
    const server = openSettings({
      cap: openCap,
      provider: {
        protocol: 'minimax-t2a',
        model: 'speech-2.8-hd',
        baseUrl: 'https://api.minimax.chat/v1',
      },
    })
    const select = await screen.findByRole('combobox', { name: '音色' })
    expect(screen.getByText(/这里只列了常用的音色/)).toBeInTheDocument()
    expect(screen.getByText('官方文档列出的常用音色，共 332 个，没有实测')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '音色名（手填）' })).toBeNull()
    await userEvent.selectOptions(select, '__other__')
    const typed = await screen.findByRole('textbox', { name: '音色名（手填）' })
    await userEvent.type(typed, 'my_clone_01')
    expect(screen.getByText(/不在常用清单里/)).toBeInTheDocument()
    await save(server)
    expect(patchBody(server).narrationVoice).toEqual({
      providerConfigId: 'prov_tts',
      voice: 'my_clone_01',
    })
  })

  it('open list without a note: still says honestly that the list is from the documentation and untested', async () => {
    const cap = speechCap({
      voices: { support: 'unverified', value: MINIMAX_VOICES },
      defaultVoice: 'male-qn-qingse',
    })
    openSettings({ cap, provider: { protocol: 'minimax-t2a', model: 'speech-2.8-hd' } })
    expect(await screen.findByText(/音色清单来自官方文档，没有实测过/)).toBeInTheDocument()
  })

  it('no system voices: a typed field only, with no list', async () => {
    const server = openSettings({
      cap: noVoicesCap,
      provider: { protocol: 'dashscope-cosyvoice', model: 'cosyvoice-v3.5-plus' },
    })
    const typed = await screen.findByRole('textbox', { name: '音色名（手填）' })
    expect(screen.queryByRole('combobox', { name: '音色' })).toBeNull()
    expect(screen.getByText(/这个型号没有系统音色，音色名只能自己写/)).toBeInTheDocument()
    await userEvent.type(typed, 'my_voice')
    await save(server)
    expect(patchBody(server).narrationVoice).toMatchObject({ voice: 'my_voice' })
  })

  it('a model with no default voice says a voice is needed, before anything is generated, and an instruction cannot be saved without one', async () => {
    const server = openSettings({
      cap: noVoicesCap,
      provider: { protocol: 'dashscope-cosyvoice', model: 'cosyvoice-v3.5-plus' },
    })
    expect(await screen.findByText(/没有默认音色，必须选一个音色才能生成配音/)).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: '风格指令（可选）' }), '平静')
    expect(await screen.findByText(/要写风格指令或语言提示，先选一个音色/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    void server
  })

  it('SiliconFlow: the format is explained, a wrong one is flagged, and choosing from the list writes it', async () => {
    const model = 'FunAudioLLM/CosyVoice2-0.5B'
    const cap = speechCap({
      voices: {
        support: 'unverified',
        value: [voice(`${model}:alex`, 'alex'), voice(`${model}:anna`, 'anna')],
      },
      defaultVoice: `${model}:alex`,
    })
    const server = openSettings({
      cap,
      provider: { protocol: 'openai-tts', model, baseUrl: 'https://api.siliconflow.cn/v1' },
    })
    const select = await screen.findByRole('combobox', { name: '音色' })
    await userEvent.selectOptions(select, `${model}:anna`)
    await save(server)
    expect(patchBody(server).narrationVoice).toEqual({
      providerConfigId: 'prov_tts',
      voice: `${model}:anna`,
    })
  })

  it('SiliconFlow typed: the format hint and a wrong form are shown', async () => {
    const model = 'FunAudioLLM/CosyVoice2-0.5B'
    openSettings({
      cap: speechCap({ voices: { support: 'unsupported', value: [] } }),
      provider: { protocol: 'openai-tts', model, baseUrl: 'https://api.siliconflow.cn/v1' },
    })
    const typed = await screen.findByRole('textbox', { name: '音色名（手填）' })
    expect(
      screen.getByText(/要写成“模型名:音色名”，例如 FunAudioLLM\/CosyVoice2-0.5B:alex/),
    ).toBeInTheDocument()
    await userEvent.type(typed, 'alex')
    expect(await screen.findByText(/写法不对：要写成“模型名:音色名”/)).toBeInTheDocument()
  })

  it('style instruction and language: shown as ignored on a model that does not take them; too long blocks saving on CosyVoice', async () => {
    openSettings({ cap: closedCap, provider: { protocol: 'openai-tts', model: 'tts-1' } })
    await userEvent.type(await screen.findByRole('textbox', { name: '风格指令（可选）' }), '开心')
    expect(await screen.findByText(/会忽略风格指令，已填的内容不会被使用/)).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: '语言提示（可选）' }), 'zh')
    expect(await screen.findByText(/会忽略语言提示/)).toBeInTheDocument()
  })

  it('a style instruction over CosyVoice’s limit says how long it is and blocks saving', async () => {
    openSettings({
      cap: speechCap({
        voices: { support: 'unverified', value: [voice('longanyang')] },
        defaultVoice: 'longanyang',
      }),
      provider: { protocol: 'dashscope-cosyvoice', model: 'cosyvoice-v3-flash' },
    })
    const box = await screen.findByRole('textbox', { name: '风格指令（可选）' })
    await userEvent.click(box)
    await userEvent.paste('平'.repeat(60))
    expect(
      await screen.findByText('风格指令太长：最多 100 个字符，汉字算 2 个，现在是 120'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('a project not delivered by speech has no voice section', async () => {
    openSettings({ cap: closedCap, project: { narrationDelivery: 'post' } })
    await screen.findByRole('dialog')
    expect(screen.queryByTestId('voice-settings')).toBeNull()
  })

  it.each([
    ['en', 'This model has only the voices in the list; choose one of them'],
    ['zh-TW', '這個型號只有清單裡的音色，只能從裡面選'],
  ] as const)('%s has the words too', async (locale, text) => {
    await switchLocale(locale)
    openSettings({ cap: closedCap })
    expect(await screen.findByText(text)).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ switching the provider

describe('switching the speech provider', () => {
  const issues = (p: Partial<Project>[], next: unknown, prev: unknown) =>
    voiceIssues(
      p.map((x, i) => project({ id: `p${i}`, name: `项目${i}`, ...x })),
      (next as typeof closedCap).capability as never,
      (prev as typeof closedCap).capability as never,
    )

  it('names the two cases apart: it belongs to the previous provider, or the new one just has no such voice', () => {
    const out = issues(
      [
        { narrationVoice: { providerConfigId: 'a', voice: 'male-qn-qingse' } },
        { narrationVoice: { providerConfigId: 'a', voice: 'nobody' } },
        { narrationVoice: { providerConfigId: 'a', voice: 'alloy' } },
      ],
      closedCap,
      openCap,
    )
    expect(out.map((i) => i.kind)).toEqual(['from_another_service', 'not_available'])
  })
  it('a project with no voice is flagged when the new model has no default, and an unlisted voice on an open list softly', () => {
    expect(issues([{}], noVoicesCap, closedCap).map((i) => i.kind)).toEqual(['required'])
    expect(issues([{}], closedCap, openCap)).toEqual([])
    expect(
      issues([{ narrationVoice: { providerConfigId: 'a', voice: 'zzz' } }], openCap, closedCap).map(
        (i) => i.kind,
      ),
    ).toEqual(['unlisted'])
    expect(
      issues(
        [{ narrationDelivery: 'post', narrationVoice: { providerConfigId: 'a', voice: 'zzz' } }],
        closedCap,
        openCap,
      ),
    ).toEqual([])
  })

  function page() {
    const a = ttsProvider({
      id: 'prov_a',
      label: '旧配音',
      protocol: 'minimax-t2a',
      model: 'speech-2.8-hd',
    })
    const b = ttsProvider({
      id: 'prov_b',
      label: '新配音',
      protocol: 'openai-tts',
      model: 'gpt-4o-mini-tts',
    })
    let active = 'prov_a'
    const proj = project({
      narrationVoice: { providerConfigId: 'prov_a', voice: 'male-qn-qingse' },
    })
    const server = fakeServer({
      'GET /api/providers': () => ({ items: [a, b] }),
      'GET /api/settings': () => ({ activeProviders: { tts: active }, cost: {} }),
      'PUT /api/settings': ({ body }) => {
        active = (body as { activeProviders: { tts: string } }).activeProviders.tts
        return body
      },
      'GET /api/projects': () => ({
        items: [
          {
            ...proj,
            episodes: [],
            shotCounts: { total: 0, withImage: 0, withVideo: 0, failed: 0 },
            thumbnails: [],
          },
        ],
      }),
      'GET /api/presets': () => ({ items: [] }),
      'GET /api/providers/prov_a/capability': () => openCap,
      'GET /api/providers/prov_b/capability': () => closedCap,
    })
    renderApp(<ProvidersPage />, { client: server.client })
    return server
  }

  it('the moment the provider is switched, the project whose voice does not fit is named, with the way to fix it', async () => {
    page()
    const card = await screen.findByRole('article', { name: '新配音' })
    expect(screen.queryByTestId('voice-switch')).toBeNull()
    await userEvent.click(within(card).getByRole('button', { name: '设为使用' }))
    const box = await screen.findByTestId('voice-switch')
    expect(box).toHaveTextContent(
      '「清朝宫廷」的音色“male-qn-qingse”是之前那家服务商的，新的服务商用不了。',
    )
    expect(within(box).getByRole('link', { name: '去重选音色' })).toHaveAttribute(
      'href',
      '/projects/proj_1?voice=1',
    )
  })
})

// ------------------------------------------------------------------ the confirm dialog

describe('the confirm dialog for narration', () => {
  const candidate = (n: number, chars?: number): BatchCandidate => ({
    shotId: `s${n}`,
    index: n,
    label: `镜头 0${n}`,
    narrationChars: chars,
    target: { kind: 'shot_audio', shotId: `s${n}` },
  })
  function open(
    codes: Record<string, { code: string; message: string }[]>,
    cap = closedCap,
    p = project(),
  ) {
    const candidates = Object.keys(codes).map((id) => ({
      ...candidate(Number(id.slice(1)), id === 's1' ? 5000 : undefined),
      shotId: id,
      target: { kind: 'shot_audio' as const, shotId: id },
    }))
    const server = fakeServer({
      'GET /api/projects/proj_1': () => p,
      'GET /api/settings': () => ({ activeProviders: { tts: 'prov_tts' }, cost: {} }),
      'GET /api/providers': () => ({
        items: [makeProvider({ id: 'prov_tts', kind: 'tts', label: '配音' })],
      }),
      'GET /api/providers/prov_tts/capability': () => cap,
      'POST /api/projects/proj_1/preflight': ({ body }) =>
        makePreflight(
          (body as { items: GenerateItem[] }).items.map((it) => {
            const id = (it.target as { shotId: string }).shotId
            const reasons = codes[id] ?? []
            return makeVerdict(`shot_audio:${id}`, {
              status: reasons.length ? 'blocked' : 'accepted',
              reasons,
            })
          }),
        ),
    })
    renderApp(
      <BatchConfirmDialog
        projectId="proj_1"
        episodeNumber={1}
        aspect="9:16"
        kind="shot_audio"
        candidates={candidates}
        assets={new Map()}
        onClose={() => {}}
      />,
      { client: server.client },
    )
    return server
  }

  it('the voice of another service and a voice this service lacks read differently, and both say where to fix it', async () => {
    open({
      s1: [{ code: 'VOICE_FROM_ANOTHER_SERVICE', message: 'x' }],
      s2: [{ code: 'VOICE_NOT_AVAILABLE', message: 'x' }],
    })
    expect(await screen.findByText(/是另一家语音服务商的，当前的服务商用不了/)).toBeInTheDocument()
    expect(screen.getByText(/没有项目里选的这个音色（它的音色是封闭清单/)).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: '去选音色' })
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute('href', '/projects/proj_1?voice=1')
  })

  it('a voice that is required but not chosen says so', async () => {
    open({ s1: [{ code: 'NARRATION_VOICE_REQUIRED', message: 'x' }] })
    expect(
      await screen.findByText(/当前的语音型号没有默认音色。先去项目设置里选一个音色/),
    ).toBeInTheDocument()
  })

  it('a narration that is too long says how long it is, what the limit is, and what to do', async () => {
    open({ s1: [{ code: 'TEXT_TOO_LONG', message: 'x' }] })
    expect(
      await screen.findByText(
        /这段旁白有 5000 个字符，当前的语音型号单次最多 4096 个。把这个镜头的旁白缩短、拆成两个镜头，或者换一个单次上限更高的语音服务商/,
      ),
    ).toBeInTheDocument()
  })

  it('a too-long narration of a shot whose length is not known still gives the way out', async () => {
    open({ s2: [{ code: 'TEXT_TOO_LONG', message: 'x' }] })
    expect(
      await screen.findByText(/这段旁白超过了当前语音型号的单次上限。把这个镜头的旁白缩短/),
    ).toBeInTheDocument()
  })

  it('a style instruction that is too long says how long it is now', async () => {
    open(
      { s2: [{ code: 'INSTRUCTION_TOO_LONG', message: 'x' }] },
      closedCap,
      project({
        narrationVoice: {
          providerConfigId: 'prov_tts',
          voice: 'alloy',
          instructions: '平'.repeat(60),
        },
      }),
    )
    expect(
      await screen.findByText(/最多 100 个字符（汉字算 2 个），现在是 120/),
    ).toBeInTheDocument()
  })

  it('a code this version has no words for shows the server’s own text', async () => {
    open({ s2: [{ code: 'SOMETHING_NEW_FROM_A_NEWER_SERVER', message: '服务端写的说明' }] })
    expect(await screen.findByText('服务端写的说明')).toBeInTheDocument()
  })

  it('every new code has copy in all three languages', () => {
    for (const code of [
      'NARRATION_VOICE_REQUIRED',
      'VOICE_NOT_AVAILABLE',
      'VOICE_FROM_ANOTHER_SERVICE',
      'VOICE_FORMAT_INVALID',
      'INSTRUCTION_TOO_LONG',
      'TEXT_TOO_LONG',
      'TEXT_TOO_LONG_PLAIN',
      'VOICE_UNLISTED',
    ])
      for (const dict of [zh, zhTW, en])
        expect((dict.reasons as Record<string, string>)[code], code).toBeTruthy()
  })
})

describe('the price of narration', () => {
  it('a range is shown as a range, and the reason is given', () => {
    const totals = {
      byCurrency: { CNY: { amount: 0.6, range: [0.3, 0.6] as [number, number], approx: true } },
      unpriced: 0,
      remaining: {},
      isEstimate: true as const,
    }
    expect(hasRange(totals)).toBe(true)
    expect(costHeadline(totals, (a, c) => `${c}${a.toFixed(2)}`)).toBe('≈ CNY0.30 – CNY0.60')
  })
  it('an unpriced run is not zero', () => {
    const totals = { byCurrency: {}, unpriced: 2, remaining: {}, isEstimate: true as const }
    expect(costHeadline(totals, () => '0')).toBeUndefined()
    expect(hasRange(totals)).toBe(false)
  })
})

// ------------------------------------------------------------------ task details and runner events

describe('task details', () => {
  const item = (job: ReturnType<typeof makeJob>) =>
    renderApp(
      <ul>
        <TaskItem
          job={job}
          now={1_700_000_100_000}
          onCancel={() => {}}
          onResume={() => {}}
          onRegenerate={() => {}}
          onAcknowledge={() => {}}
          onIgnoreResult={() => {}}
        />
      </ul>,
      { client: fakeServer({}).client },
    )
  it('the inputs a finished narration did not use are listed', () => {
    item(makeJob({ status: 'succeeded', result: { ignoredInputs: ['instructions', 'speed'] } }))
    const line = screen.getByTestId('ignored-inputs')
    expect(line).toHaveTextContent('风格指令（这个型号不支持，没有使用）')
    expect(line).toHaveTextContent('语速（超出服务商的范围，已调整到范围内）')
  })
  it('nothing is said when nothing was dropped', () => {
    item(makeJob({ status: 'succeeded', result: { versionId: 'v' } }))
    expect(screen.queryByTestId('ignored-inputs')).toBeNull()
  })
  it('a failure code this version does not know shows the server’s text, not a blank', () => {
    item(
      failedJob('generation_failed', {
        error: {
          category: 'generation_failed',
          code: 'BRAND_NEW_CODE',
          message: '服务端的原话',
          recoverable: false,
        },
      }),
    )
    expect(screen.getByTestId('raw-error')).toHaveTextContent('服务端的原话')
  })
  it('a code that is explained does not repeat the raw text', () => {
    item(
      failedJob('generation_failed', {
        error: {
          category: 'generation_failed',
          code: 'MINIMAX_20132',
          message: '原文',
          recoverable: false,
        },
      }),
    )
    expect(screen.queryByTestId('raw-error')).toBeNull()
    expect(screen.getByTestId('provider-error')).toHaveTextContent('服务商说没有这个音色')
  })
})

describe('the automatic mute did not finish', () => {
  it('is recognised from the server’s words, and is not a runner failure', () => {
    expect(workerErrorKind('时间线默认静音没有完成（视频已保存）：TypeError')).toBe('mute_not_set')
    expect(workerErrorKind('boom')).toBe('runner')
  })

  function Push({ message }: { message: string }) {
    const store = useContext(StoreContext)
    useEffect(() => store?.setWorkerError(message), [store, message])
    return null
  }
  const panel = (message: string) =>
    renderApp(
      <>
        <Push message={message} />
        <TaskPanel />
      </>,
      {
        client: fakeServer({
          'GET /api/jobs': () => ({ items: [] }),
          'GET /api/projects': () => ({ items: [] }),
        }).client,
      },
    )

  it('shows a quiet note that the video is saved, not an error banner', async () => {
    panel('时间线默认静音没有完成（视频已保存）：TypeError')
    expect(await screen.findByText('时间线的默认静音没有设上')).toBeInTheDocument()
    expect(screen.getByText(/视频已经生成并保存了，没有失败/)).toBeInTheDocument()
    expect(screen.queryByText('任务执行器出错了')).toBeNull()
  })
  it('any other runner error is still shown as one', async () => {
    panel('boom')
    expect(await screen.findByText('任务执行器出错了')).toBeInTheDocument()
  })
})
