import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { protocolId, type LoginStatusDto } from '@dramai/api'
import {
  groupPresets,
  inputProblems,
  matchesQuery,
  needsInput,
  resolveBaseUrl,
  type Preset,
} from '@/features/settings/catalog-model'
import {
  dialectChanged,
  dialectOf,
  dialectSupport,
  draftOf,
  headerProblems,
  parseExtraBody,
} from '@/features/settings/dialect-model'
import { LoginPanel } from '@/features/settings/LoginPanel'
import {
  ALL_PROTOCOLS,
  PROTOCOLS_BY_KIND,
  kindOfProtocol,
  protocolLabel,
} from '@/features/settings/protocols'
import { ProvidersPage } from '@/features/settings/ProvidersPage'
import { PlanUsageNote } from '@/features/common/PlanUsageNote'
import en from '@/i18n/locales/en'
import zh from '@/i18n/locales/zh-CN'
import zhTW from '@/i18n/locales/zh-TW'
import { fakeServer } from './fixtures'
import { makeCapabilityView } from './fixtures-production'
import {
  OR_MANAGE,
  makeKeyProvider,
  makeLogin,
  makeOpenRouterProvider,
  makePreset,
} from './fixtures-providers'
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
beforeEach(async () => {
  vi.stubGlobal('localStorage', memoryStorage())
  await useLocale('zh-CN')
})
afterEach(() => vi.unstubAllGlobals())

const p = (over: Record<string, unknown> = {}) => makePreset(over) as unknown as Preset
const catalog: Preset[] = [
  p({
    id: 'a-doc',
    label: 'Alpha Cloud',
    baseUrl: 'https://api.alpha.example/v1',
    vendor: { id: 'alpha', label: 'Alpha' },
    region: 'global',
    verification: { status: 'documented', source: 'https://alpha.example/docs' },
    verifiedAt: undefined,
  }),
  p({ id: 'ds', label: 'DeepSeek', vendor: { id: 'deepseek', label: 'DeepSeek' }, region: 'cn' }),
  p({
    id: 'al-cn',
    label: 'Aliyun CN',
    vendor: { id: 'aliyun', label: '阿里云' },
    region: 'cn',
    baseUrl: 'https://{WorkspaceId}.dashscope.aliyuncs.com/compatible-mode/v1',
    baseUrlPlaceholders: ['WorkspaceId'],
    suggestedModel: 'qwen-plus',
    verification: { status: 'documented', source: 'https://help.aliyun.com/x' },
    verifiedAt: undefined,
  }),
  p({
    id: 'al-gl',
    label: 'Aliyun Intl',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/v1',
    vendor: { id: 'aliyun', label: '阿里云' },
    region: 'global',
    verification: { status: 'documented', source: 'https://help.aliyun.com/y' },
    verifiedAt: undefined,
  }),
  p({
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
]

describe('protocol names', () => {
  it('every protocol in the contract belongs to a kind and has a name in all three languages', () => {
    expect([...ALL_PROTOCOLS].sort()).toEqual([...protocolId.options].sort())
    const inKinds = Object.values(PROTOCOLS_BY_KIND).flat()
    // every protocol a custom provider can pick is offered under some kind
    for (const proto of ['openai-chat', 'openai-responses', 'anthropic-messages', 'gemini-chat'])
      expect(inKinds).toContain(proto)
    for (const [name, dict] of Object.entries({ 'zh-CN': zh, 'zh-TW': zhTW, en })) {
      for (const proto of protocolId.options)
        expect(
          (dict.protocol as Record<string, string>)[proto],
          `${name} protocol.${proto}`,
        ).toBeTruthy()
    }
  })
  it('a protocol without copy shows its id instead of breaking the page', () => {
    const t = ((_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k) as never
    expect(protocolLabel(t, 'brand-new-protocol')).toBe('brand-new-protocol')
  })
})

describe('catalog model', () => {
  it('groups by vendor; vendors with a tested preset first; tested first, then region, inside a vendor', () => {
    const groups = groupPresets(catalog)
    expect(groups.map((g) => g.vendor.id)).toEqual(['deepseek', 'alpha', 'aliyun', 'lmstudio'])
    expect(groups.find((g) => g.vendor.id === 'aliyun')!.presets.map((x) => x.id)).toEqual([
      'al-cn',
      'al-gl',
    ])
  })
  it('searches name, vendor and address host, case-insensitively', () => {
    expect(groupPresets(catalog, 'deep').map((g) => g.vendor.id)).toEqual(['deepseek'])
    expect(groupPresets(catalog, '阿里').map((g) => g.vendor.id)).toEqual(['aliyun'])
    expect(groupPresets(catalog, 'ALPHA').flatMap((g) => g.presets.map((x) => x.id))).toEqual([
      'a-doc',
    ])
    expect(matchesQuery(catalog[1]!, 'deepseek.com')).toBe(true)
    expect(groupPresets(catalog, 'zzz')).toEqual([])
    expect(groupPresets(catalog, '  ')).toHaveLength(4)
  })
  it('knows which presets need the user: placeholders in the address, or no suggested model', () => {
    expect(needsInput(catalog[2]!)).toBe(true)
    expect(needsInput(catalog[4]!)).toBe(true)
    expect(needsInput(catalog[1]!)).toBe(false)
  })
  it('validates the values and puts them into the address', () => {
    const aliyun = catalog[2]!
    expect(inputProblems(aliyun, {}, '')).toEqual([{ field: 'WorkspaceId', kind: 'missing' }])
    expect(inputProblems(aliyun, { WorkspaceId: 'a b/c' }, '')).toEqual([
      { field: 'WorkspaceId', kind: 'invalid' },
    ])
    expect(inputProblems(aliyun, { WorkspaceId: 'ws-123' }, '')).toEqual([])
    expect(inputProblems(catalog[4]!, {}, ' ')).toEqual([{ field: 'model', kind: 'missing' }])
    expect(resolveBaseUrl(aliyun.baseUrl, { WorkspaceId: ' ws-123 ' })).toBe(
      'https://ws-123.dashscope.aliyuncs.com/compatible-mode/v1',
    )
    expect(resolveBaseUrl(aliyun.baseUrl, {})).toContain('{WorkspaceId}')
  })
})

describe('dialect model', () => {
  it('extra body: empty is none, must be a JSON object, reformatting is not a change', () => {
    expect(parseExtraBody('')).toEqual({ ok: true, value: undefined })
    expect(parseExtraBody('{}')).toEqual({ ok: true, value: undefined })
    expect(parseExtraBody('{"enable_thinking": false}')).toEqual({
      ok: true,
      value: { enable_thinking: false },
    })
    expect(parseExtraBody('{oops')).toEqual({ ok: false, kind: 'invalid' })
    expect(parseExtraBody('[1]')).toEqual({ ok: false, kind: 'notObject' })
    expect(parseExtraBody('"x"')).toEqual({ ok: false, kind: 'notObject' })
    const chat = dialectSupport('openai-chat')!
    const saved = { extraBody: { b: 1, a: { y: 1, x: 2 } }, jsonMode: 'prompt_only' as const }
    const draft = draftOf(saved)
    expect(dialectChanged(draft, saved, chat)).toBe(false)
    expect(dialectChanged({ ...draft, extraBody: '{"a":{"x":2,"y":1},"b":1}' }, saved, chat)).toBe(
      false,
    )
    expect(dialectChanged({ ...draft, jsonMode: '' }, saved, chat)).toBe(true)
    expect(dialectChanged({ ...draft, extraBody: '{' }, saved, chat)).toBe(true)
    expect(dialectOf({ ...draft, extraBody: '{' }, chat)).toBeUndefined()
    expect(
      dialectOf(
        {
          extraBody: '',
          maxTokensField: 'max_completion_tokens',
          jsonMode: '',
          imageStyle: '',
          headers: [],
        },
        chat,
      ),
    ).toEqual({ maxTokensField: 'max_completion_tokens' })
  })

  it('what each protocol reads (from the request builders): chat all, Anthropic and Gemini body + headers, Responses headers only', () => {
    expect(dialectSupport('openai-chat')).toMatchObject({
      extraBody: true,
      maxTokensField: true,
      jsonMode: true,
      extraHeaders: true,
      protectedBody: ['model', 'messages', 'stream'],
    })
    expect(dialectSupport('anthropic-messages')).toMatchObject({
      extraBody: true,
      maxTokensField: false,
      jsonMode: false,
      extraHeaders: true,
    })
    expect(dialectSupport('gemini-chat')).toMatchObject({
      extraBody: true,
      extraHeaders: true,
      protectedBody: ['contents'],
    })
    expect(dialectSupport('openai-responses')).toMatchObject({
      extraBody: false,
      maxTokensField: false,
      jsonMode: false,
      extraHeaders: true,
    })
    // every other protocol, image, video and speech alike, reads the extra headers only (images also the style)
    for (const p of ALL_PROTOCOLS.filter((p) => kindOfProtocol(p) !== 'llm')) {
      const s = dialectSupport(p)
      expect([p, s.extraHeaders, s.extraBody, s.maxTokensField, s.jsonMode, s.media]).toEqual([
        p,
        true,
        false,
        false,
        false,
        true,
      ])
      expect([p, s.imageStyle]).toEqual([p, p === 'openai-images'])
    }
  })

  it('only sends what the protocol reads, and a leftover from another protocol is not a change', () => {
    const anthropic = dialectSupport('anthropic-messages')!
    const saved = { jsonMode: 'prompt_only' as const, extraBody: { x: 1 } }
    const draft = draftOf(saved)
    expect(dialectChanged(draft, saved, anthropic)).toBe(false)
    expect(dialectOf({ ...draft, maxTokensField: 'max_tokens' }, anthropic)).toEqual({
      extraBody: { x: 1 },
    })
  })

  it('extra headers: names, protected names, duplicates, line breaks, empty values', () => {
    expect(headerProblems([{ name: '', value: '' }])).toEqual([])
    expect(headerProblems([{ name: 'anthropic-workspace-id', value: 'ws_1' }])).toEqual([])
    expect(headerProblems([{ name: 'bad name', value: 'x' }])).toEqual([{ index: 0, kind: 'name' }])
    expect(headerProblems([{ name: 'Authorization', value: 'x' }])).toEqual([
      { index: 0, kind: 'protected' },
    ])
    expect(headerProblems([{ name: 'X-API-Key', value: 'x' }])).toEqual([
      { index: 0, kind: 'protected' },
    ])
    expect(
      headerProblems([
        { name: 'a', value: '1' },
        { name: 'A', value: '2' },
      ]),
    ).toEqual([{ index: 1, kind: 'duplicate' }])
    expect(headerProblems([{ name: 'a', value: 'x\ny' }])).toEqual([{ index: 0, kind: 'value' }])
    expect(headerProblems([{ name: 'a', value: ' ' }])).toEqual([{ index: 0, kind: 'empty' }])
    const chat = dialectSupport('openai-chat')!
    expect(
      dialectOf(
        {
          extraBody: '',
          maxTokensField: '',
          jsonMode: '',
          imageStyle: '',
          headers: [{ name: 'x-a', value: '1' }],
        },
        chat,
      ),
    ).toEqual({ extraHeaders: { 'x-a': '1' } })
    expect(
      dialectOf(
        {
          extraBody: '',
          maxTokensField: '',
          jsonMode: '',
          imageStyle: '',
          headers: [{ name: 'Authorization', value: '1' }],
        },
        chat,
      ),
    ).toBeUndefined()
  })
})

function page(opts: {
  providers: unknown[]
  presets?: unknown[]
  routes?: Parameters<typeof fakeServer>[0]
  active?: Record<string, string>
}) {
  const server = fakeServer({
    'GET /api/providers': () => ({ items: opts.providers }),
    'GET /api/settings': () => ({ activeProviders: opts.active ?? {}, cost: {} }),
    'PUT /api/settings': ({ body }) => body,
    'GET /api/projects': () => ({ items: [] }),
    'GET /api/presets': () => ({ items: opts.presets ?? catalog }),
    'GET /api/providers/prov_key/capability': () => makeCapabilityView(),
    'GET /api/providers/prov_new/capability': () => makeCapabilityView(),
    ...opts.routes,
  })
  const view = renderApp(<ProvidersPage />, { client: server.client })
  return { ...view, server }
}
const openCatalog = async () => {
  const section = await screen.findByRole('region', { name: /大模型/ })
  await userEvent.click(within(section).getByRole('button', { name: '添加服务商' }))
  return screen.findByRole('dialog', { name: '添加服务商' })
}

describe('the catalog dialog', () => {
  it('groups presets by vendor with region and verification status on each', async () => {
    page({ providers: [] })
    const dialog = await openCatalog()
    const groups = await within(dialog).findAllByRole('region')
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual([
      'DeepSeek',
      'Alpha',
      '阿里云',
      'LM Studio',
    ])
    const aliyun = within(dialog).getByRole('region', { name: '阿里云' })
    expect(within(aliyun).getByRole('button', { name: /Aliyun CN/ })).toHaveTextContent('国内站')
    expect(within(aliyun).getByRole('button', { name: /Aliyun Intl/ })).toHaveTextContent('国际站')
    expect(within(dialog).getByRole('button', { name: /DeepSeek/ })).toHaveTextContent(
      '已实测 · 2026-05-04',
    )
    expect(within(dialog).getByRole('button', { name: /Alpha Cloud/ })).toHaveTextContent(
      '按官方文档接入，未实测',
    )
    expect(within(dialog).getByRole('button', { name: /LM Studio/ })).toHaveTextContent('本机')
    expect(within(dialog).getByText('本机服务：要先在这台电脑上启动它')).toBeInTheDocument()
  })

  it('search narrows the list by name, and says so when nothing matches', async () => {
    page({ providers: [] })
    const dialog = await openCatalog()
    await userEvent.type(
      await within(dialog).findByRole('searchbox', { name: '搜索服务商' }),
      'deep',
    )
    expect(
      within(dialog)
        .getAllByRole('region')
        .map((g) => g.getAttribute('aria-label')),
    ).toEqual(['DeepSeek'])
    await userEvent.clear(within(dialog).getByRole('searchbox'))
    await userEvent.type(within(dialog).getByRole('searchbox'), 'qqq')
    expect(within(dialog).getByText(/没有匹配“qqq”的预设/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '自定义服务商' })).toBeInTheDocument()
  })

  it('a preset with a placeholder cannot be created until it is filled; the value ends up in the address', async () => {
    const created = makeKeyProvider({
      id: 'prov_new',
      label: 'Aliyun CN',
      baseUrl: 'https://{WorkspaceId}.dashscope.aliyuncs.com/compatible-mode/v1',
      verification: { status: 'documented', source: 'x' },
    })
    const { server } = page({
      providers: [],
      routes: {
        'POST /api/providers/from-preset': () => created,
      },
    })
    const dialog = await openCatalog()
    await userEvent.click(within(dialog).getByRole('button', { name: /Aliyun CN/ }))
    const fill = await screen.findByRole('dialog', { name: '添加「Aliyun CN」' })
    await userEvent.click(within(fill).getByRole('button', { name: '添加' }))
    expect(await within(fill).findByText(/要填写 WorkspaceId/)).toBeInTheDocument()
    expect(
      server.calls.some((c) => c.method === 'POST' && c.path === '/api/providers/from-preset'),
    ).toBe(false)
    await userEvent.type(within(fill).getByRole('textbox', { name: /WorkspaceId/ }), 'ws-42')
    await userEvent.click(within(fill).getByRole('button', { name: '添加' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.path === '/api/providers/from-preset')?.body).toEqual({
        presetId: 'al-cn',
        baseUrl: 'https://ws-42.dashscope.aliyuncs.com/compatible-mode/v1',
      }),
    )
    expect(server.calls.some((c) => c.method === 'PATCH')).toBe(false) // one call, not two
  })

  it('a bad placeholder value is refused with a reason', async () => {
    page({ providers: [] })
    const dialog = await openCatalog()
    await userEvent.click(within(dialog).getByRole('button', { name: /Aliyun CN/ }))
    const fill = await screen.findByRole('dialog', { name: '添加「Aliyun CN」' })
    await userEvent.type(within(fill).getByRole('textbox', { name: /WorkspaceId/ }), 'a b')
    await userEvent.click(within(fill).getByRole('button', { name: '添加' }))
    expect(await within(fill).findByText(/只能包含字母、数字/)).toBeInTheDocument()
  })

  it('a local preset with no suggested model asks for the model and says to start the service first', async () => {
    const created = makeKeyProvider({
      id: 'prov_new',
      label: 'LM Studio',
      auth: { type: 'none' },
      hasKey: false,
      model: '',
    })
    const { server } = page({
      providers: [],
      routes: {
        'POST /api/providers/from-preset': () => created,
      },
    })
    const dialog = await openCatalog()
    await userEvent.click(within(dialog).getByRole('button', { name: /LM Studio/ }))
    const fill = await screen.findByRole('dialog', { name: '添加「LM Studio」' })
    expect(within(fill).getByText(/先在这台电脑上启动它/)).toBeInTheDocument()
    await userEvent.click(within(fill).getByRole('button', { name: '添加' }))
    expect(await within(fill).findByText('要填写模型名')).toBeInTheDocument()
    await userEvent.type(within(fill).getByRole('textbox', { name: /模型/ }), 'llama-3')
    await userEvent.click(within(fill).getByRole('button', { name: '添加' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.path === '/api/providers/from-preset')?.body).toEqual({
        presetId: 'lm',
        model: 'llama-3',
      }),
    )
  })

  it('a preset that needs nothing is created at once, and a documented-only one is not made current', async () => {
    const created = makeKeyProvider({
      id: 'prov_new',
      label: 'Alpha Cloud',
      verification: { status: 'documented', source: 'https://alpha.example/docs' },
    })
    let list: unknown[] = []
    const { server } = page({
      providers: [],
      routes: {
        'GET /api/providers': () => ({ items: list }),
        'POST /api/providers/from-preset': () => {
          list = [created]
          return created
        },
      },
    })
    const dialog = await openCatalog()
    await userEvent.click(within(dialog).getByRole('button', { name: /Alpha Cloud/ }))
    expect(await screen.findByText('已添加「Alpha Cloud」')).toBeInTheDocument()
    expect(server.calls.some((c) => c.method === 'PUT' && c.path === '/api/settings')).toBe(false)
    expect(server.calls.some((c) => c.method === 'PATCH')).toBe(false)
  })

  it('the custom provider dialog is still one click away', async () => {
    page({ providers: [] })
    const dialog = await openCatalog()
    await userEvent.click(within(dialog).getByRole('button', { name: '自定义服务商' }))
    expect(await screen.findByRole('dialog', { name: '添加自定义服务商' })).toBeInTheDocument()
  })
})

describe('advanced settings (dialect)', () => {
  const card = async () => {
    const c = await screen.findByRole('article', { name: 'DeepSeek' })
    await userEvent.click(within(c).getByRole('button', { name: /展开/ }))
    return c
  }
  const save = (server: ReturnType<typeof page>['server']) =>
    server.calls.find((c) => c.method === 'PATCH')?.body

  it('is collapsed by default, for every kind of provider', async () => {
    page({
      providers: [
        makeKeyProvider(),
        makeKeyProvider({ id: 'prov_img', label: 'Img', kind: 'image', protocol: 'kling-image' }),
      ],
      routes: { 'GET /api/providers/prov_img/capability': () => makeCapabilityView() },
    })
    const c = await card()
    const details = within(c).getByText('高级设置').closest('details')!
    expect(details.open).toBe(false)
    const img = await screen.findByRole('article', { name: 'Img' })
    await userEvent.click(within(img).getByRole('button', { name: /展开/ }))
    expect(within(img).getByText('高级设置')).toBeInTheDocument()
  })

  it('explains what extra body is for, and invalid JSON can never be saved', async () => {
    page({ providers: [makeKeyProvider()] })
    const c = await card()
    expect(within(c).getByText(/给默认开启思考的模型关掉思考/)).toBeInTheDocument()
    const box = within(c).getByRole('textbox', { name: /额外请求体/ })
    await userEvent.click(box)
    await userEvent.paste('{oops')
    expect(await within(c).findByText('这不是合法的 JSON，改好才能保存')).toBeInTheDocument()
    expect(within(c).getByRole('button', { name: '保存' })).toBeDisabled()
    await userEvent.clear(box)
    await userEvent.click(box)
    await userEvent.paste('[1]')
    expect(await within(c).findByText(/要写成 JSON 对象/)).toBeInTheDocument()
    expect(within(c).getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('saves a valid extra body and the two choices as the provider’s dialect', async () => {
    const { server } = page({
      providers: [makeKeyProvider()],
      routes: {
        'PATCH /api/providers/prov_key': ({ body }) => ({
          ...makeKeyProvider(),
          ...(body as object),
        }),
      },
    })
    const c = await card()
    const box = within(c).getByRole('textbox', { name: /额外请求体/ })
    await userEvent.click(box)
    await userEvent.paste('{"enable_thinking": false}')
    await userEvent.selectOptions(
      within(c).getByRole('combobox', { name: /输出长度字段/ }),
      'max_completion_tokens',
    )
    await userEvent.selectOptions(
      within(c).getByRole('combobox', { name: /JSON 输出方式/ }),
      'prompt_only',
    )
    await userEvent.click(within(c).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(save(server)).toMatchObject({
        dialect: {
          extraBody: { enable_thinking: false },
          maxTokensField: 'max_completion_tokens',
          jsonMode: 'prompt_only',
        },
      }),
    )
  })

  it('shows what a preset pre-filled, and saving without touching it does not resend it', async () => {
    page({
      providers: [
        makeKeyProvider({
          dialect: { extraBody: { enable_thinking: false }, jsonMode: 'prompt_only' },
        }),
      ],
    })
    const c = await card()
    expect(within(c).getByRole('textbox', { name: /额外请求体/ })).toHaveValue(
      '{\n  "enable_thinking": false\n}',
    )
    expect(within(c).getByRole('combobox', { name: /JSON 输出方式/ })).toHaveValue('prompt_only')
    expect(within(c).getByRole('button', { name: '保存' })).toBeDisabled()
  })
})

describe('listing models for Anthropic and Gemini', () => {
  it.each([
    ['anthropic-messages', 'claude-sonnet'],
    ['gemini-chat', 'gemini-pro'],
  ])('%s: a button fetches the list and the model is chosen from it', async (protocol, model) => {
    const { server } = page({
      providers: [makeKeyProvider({ protocol, model: 'typed' })],
      routes: {
        'GET /api/providers/prov_key/models': () => ({
          items: [
            { id: model, label: model },
            { id: `${model}-2`, label: `${model} 2` },
          ],
        }),
      },
    })
    const c = await screen.findByRole('article', { name: 'DeepSeek' })
    await userEvent.click(within(c).getByRole('button', { name: /展开/ }))
    expect(server.calls.some((x) => x.path.endsWith('/models'))).toBe(false) // nothing is requested until asked
    await userEvent.click(within(c).getByRole('button', { name: '获取模型列表' }))
    const select = await within(c).findByRole('combobox', { name: '模型' })
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['typed', model, `${model} 2 (${model}-2)`])
  })

  it('a provider without a model list says so and keeps the typed field', async () => {
    const { apiError } = await import('./fixtures')
    page({
      providers: [makeKeyProvider()],
      routes: {
        'GET /api/providers/prov_key/models': () => apiError(409, 'MODEL_LIST_UNSUPPORTED'),
      },
    })
    const c = await screen.findByRole('article', { name: 'DeepSeek' })
    await userEvent.click(within(c).getByRole('button', { name: /展开/ }))
    await userEvent.click(within(c).getByRole('button', { name: '获取模型列表' }))
    expect(
      await within(c).findByText('这个服务商没有模型列表，请手动填写模型名'),
    ).toBeInTheDocument()
    expect(within(c).queryByRole('button', { name: '获取模型列表' })).toBeNull()
  })

  it('no list button when there is no key to ask with', async () => {
    page({
      providers: [
        makeKeyProvider({ protocol: 'anthropic-messages', hasKey: false, keyMask: undefined }),
      ],
    })
    const c = await screen.findByRole('article', { name: 'DeepSeek' })
    await userEvent.click(within(c).getByRole('button', { name: /展开/ }))
    expect(within(c).queryByRole('button', { name: '获取模型列表' })).toBeNull()
  })
})

describe('OpenRouter sign-in', () => {
  function setup(
    initial: Partial<LoginStatusDto> = {},
    over: Parameters<typeof fakeServer>[0] = {},
  ) {
    const state = { status: makeLogin({ channel: 'openrouter', ...initial }) }
    const server = fakeServer({
      'GET /api/providers/prov_or/login': () => state.status,
      'POST /api/providers/prov_or/login/start': () => {
        state.status = makeLogin({
          channel: 'openrouter',
          state: 'pending',
          pending: { expiresAt: new Date(Date.now() + 600_000).toISOString() },
        })
        return {
          authorizationUrl: 'https://openrouter.ai/auth?callback_url=x',
          redirectUri: 'http://localhost:3000/callback',
          expiresAt: state.status.pending!.expiresAt,
        }
      },
      'POST /api/providers/prov_or/login/cancel': () => {
        state.status = makeLogin({ channel: 'openrouter', state: 'signed_out' })
        return state.status
      },
      'POST /api/providers/prov_or/login/logout': () => {
        state.status = makeLogin({ channel: 'openrouter', state: 'signed_out' })
        return { status: state.status, revoked: 'unconfirmed' }
      },
      'GET /api/providers': () => ({ items: [] }),
      ...over,
    })
    const view = renderApp(<LoginPanel provider={makeOpenRouterProvider(initial)} pollMs={25} />, {
      client: server.client,
    })
    return { ...view, server, state }
  }

  it('signed out: a plain-text button, and nothing from OpenAI’s ChatGPT wording', async () => {
    setup()
    expect(
      await screen.findByRole('button', { name: '用 OpenRouter 账号登录' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/OpenRouter 会给 dramai 一把属于你自己的 API Key/)).toBeInTheDocument()
    expect(screen.queryByText(/ChatGPT/)).toBeNull()
  })

  it('waiting: Cancel is the main action and says to use it if you already declined', async () => {
    const { server } = setup({
      state: 'pending',
      pending: { expiresAt: new Date(Date.now() + 600_000).toISOString() },
    })
    expect(await screen.findByText(/如果你已经在浏览器里拒绝了授权/)).toBeInTheDocument()
    const cancel = screen.getByRole('button', { name: '取消登录' })
    expect(cancel.className).toMatch(/bg-accent/) // the primary variant
    await userEvent.click(cancel)
    await waitFor(() =>
      expect(server.calls.some((c) => c.path.endsWith('/login/cancel'))).toBe(true),
    )
    expect(
      await screen.findByRole('button', { name: '用 OpenRouter 账号登录' }),
    ).toBeInTheDocument()
  })

  it('declined on the authorization page: no callback arrives, it stays waiting until the user cancels', async () => {
    const { server } = setup({
      state: 'pending',
      pending: { expiresAt: new Date(Date.now() + 600_000).toISOString() },
    })
    await screen.findByText('请在浏览器里完成授权')
    // it keeps asking while it waits (wait for the polls instead of a fixed pause: a loaded machine polls less often)
    const polls = () =>
      server.calls.filter((c) => c.method === 'GET' && c.path.endsWith('/login')).length
    await waitFor(() => expect(polls()).toBeGreaterThan(2), { timeout: 5000 })
    expect(screen.getByText('请在浏览器里完成授权')).toBeInTheDocument() // still waiting, never a "denied" message
    expect(screen.queryByText(/拒绝了登录/)).toBeNull()
  })

  it('signed in: a key obtained by signing in, its mask and a link to manage it; no account, expiry or plan', async () => {
    setup({
      state: 'signed_in',
      credential: { kind: 'api_key', mask: 'sk-or-…ab12' },
      manageUrl: OR_MANAGE,
    })
    expect(await screen.findByText('已用 OpenRouter 账号登录')).toBeInTheDocument()
    expect(screen.getByText('这把 Key 是登录得到的：sk-or-…ab12')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /管理这把 Key/ })).toHaveAttribute('href', OR_MANAGE)
    expect(screen.queryByText(/到期/)).toBeNull()
    expect(screen.queryByText('正在使用 ChatGPT 套餐')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull() // OpenAI's welcome note is OpenAI-only
    expect(screen.getByText(/旧的那把在 OpenRouter 上仍然有效/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新登录（换一把新 Key）' })).toBeInTheDocument()
  })

  it('a completed sign-in shows no welcome note', async () => {
    const { state } = setup({
      state: 'pending',
      pending: { expiresAt: new Date(Date.now() + 600_000).toISOString() },
    })
    await screen.findByText('请在浏览器里完成授权')
    state.status = makeLogin({
      channel: 'openrouter',
      state: 'signed_in',
      credential: { kind: 'api_key', mask: 'sk-or-…ab12' },
      manageUrl: OR_MANAGE,
    })
    await screen.findByText('已用 OpenRouter 账号登录')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('from another machine: no button, the reason', async () => {
    setup({ availability: { available: false, reason: 'remote_access' } })
    expect(await screen.findByText(/从别的机器访问的/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '用 OpenRouter 账号登录' })).toBeNull()
  })

  it('“Using ChatGPT plan” is never shown for OpenRouter, even signed in and in use', async () => {
    const server = fakeServer({
      'GET /api/providers': () => ({
        items: [
          makeOpenRouterProvider({
            state: 'signed_in',
            credential: { kind: 'api_key', mask: 'x' },
            manageUrl: OR_MANAGE,
          }),
        ],
      }),
      'GET /api/settings': () => ({ activeProviders: { llm: 'prov_or' }, cost: {} }),
    })
    renderApp(<PlanUsageNote />, { client: server.client })
    await new Promise((r) => setTimeout(r, 120))
    expect(screen.queryByText('正在使用 ChatGPT 套餐')).toBeNull()
  })

  it('on a provider card, the sign-in panel for OpenRouter replaces the key field', async () => {
    page({
      providers: [makeOpenRouterProvider({ state: 'signed_out' })],
      routes: { 'GET /api/providers/prov_or/capability': () => makeCapabilityView() },
    })
    const c = await screen.findByRole('article', { name: 'OpenRouter (sign-in)' })
    await userEvent.click(within(c).getByRole('button', { name: /展开/ }))
    expect(within(c).queryByText('API Key')).toBeNull()
    expect(within(c).getByRole('button', { name: '用 OpenRouter 账号登录' })).toBeInTheDocument()
    expect(within(c).getByRole('textbox', { name: 'Base URL' })).toHaveAttribute('readonly')
  })
})

describe('task errors for text providers', () => {
  it('every new task error code has copy in all three languages', () => {
    for (const [name, dict] of Object.entries({ 'zh-CN': zh, 'zh-TW': zhTW, en })) {
      for (const code of [
        'EMPTY_OUTPUT_TRUNCATED',
        'STREAM_INTERRUPTED',
        'overloaded_error',
        'rate_limit_error',
        'authentication_error',
        'invalid_request_error',
        'GEMINI_SAFETY',
        'GEMINI_PROMPT_SAFETY',
        'GEMINI_RECITATION',
        'GEMINI_IMAGE_URL_UNSUPPORTED',
        'INVALID_ARGUMENT',
        'RESOURCE_EXHAUSTED',
        'PERMISSION_DENIED',
      ]) {
        const e = (
          dict.providerErrors as unknown as Record<string, { title: string; body: string }>
        )[code]
        expect(e?.title, `${name} ${code}`).toBeTruthy()
        expect(e?.body, `${name} ${code}`).toBeTruthy()
      }
    }
  })
})
