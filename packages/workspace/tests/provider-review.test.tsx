import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoginStatusDto } from '@dramai/api'
import { inputProblems } from '@/features/settings/catalog-model'
import { LoginPanel } from '@/features/settings/LoginPanel'
import { safeHttpUrl } from '@/lib/safe-url'
import zhTW from '@/i18n/locales/zh-TW'
import { ProvidersPage } from '@/features/settings/ProvidersPage'
import { apiError, fakeServer } from './fixtures'
import { makeCapabilityView } from './fixtures-production'
import {
  OR_MANAGE,
  makeKeyProvider,
  makeLogin,
  makeLoginProvider,
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

function page(opts: {
  providers: unknown[]
  presets?: unknown[]
  routes?: Parameters<typeof fakeServer>[0]
}) {
  const server = fakeServer({
    'GET /api/providers': () => ({ items: opts.providers }),
    'GET /api/settings': () => ({ activeProviders: {}, cost: {} }),
    'GET /api/projects': () => ({ items: [] }),
    'GET /api/presets': () => ({ items: opts.presets ?? [] }),
    'GET /api/providers/prov_or/capability': () => makeCapabilityView(),
    'GET /api/providers/prov_login/capability': () => makeCapabilityView(),
    'GET /api/providers/prov_key/capability': () => makeCapabilityView(),
    ...opts.routes,
  })
  const view = renderApp(<ProvidersPage />, { client: server.client })
  return { ...view, server }
}

describe('M1: OpenRouter’s card carries no OpenAI wording', () => {
  const allText = (el: HTMLElement) =>
    [
      el.textContent ?? '',
      ...[...el.querySelectorAll('[title],[aria-label]')].map(
        (n) => `${n.getAttribute('title')} ${n.getAttribute('aria-label')}`,
      ),
    ].join(' ')

  it.each(['signed_out', 'pending', 'signed_in'] as const)(
    '%s: collapsed and expanded, never says ChatGPT',
    async (state) => {
      page({
        providers: [
          makeOpenRouterProvider({
            state,
            ...(state === 'pending'
              ? { pending: { expiresAt: new Date(Date.now() + 600_000).toISOString() } }
              : {}),
            ...(state === 'signed_in'
              ? { credential: { kind: 'api_key', mask: 'sk-or-…1' }, manageUrl: OR_MANAGE }
              : {}),
          }),
        ],
      })
      const card = await screen.findByRole('article', { name: 'OpenRouter (sign-in)' })
      expect(allText(card)).not.toMatch(/ChatGPT/i)
      expect(within(card).getByText('OpenRouter 账号登录')).toBeInTheDocument() // the chip names its own channel
      await userEvent.click(within(card).getByRole('button', { name: /展开/ }))
      expect(allText(card)).not.toMatch(/ChatGPT/i)
    },
  )

  it('the test button’s reason is visible text, names OpenRouter, and does not say ChatGPT', async () => {
    page({ providers: [makeOpenRouterProvider({ state: 'signed_out' })] })
    const card = await screen.findByRole('article', { name: 'OpenRouter (sign-in)' })
    await userEvent.click(within(card).getByRole('button', { name: /展开/ }))
    expect(within(card).getByRole('button', { name: /测试连接/ })).toBeDisabled()
    expect(within(card).getByText('先用 OpenRouter 账号登录，再测试连接')).toBeInTheDocument()
  })

  it('the OpenAI card still says ChatGPT', async () => {
    page({ providers: [makeLoginProvider({}, { state: 'signed_out' })] })
    const card = await screen.findByRole('article', { name: 'OpenAI (ChatGPT sign-in)' })
    expect(within(card).getByText('ChatGPT 账号登录')).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: /展开/ }))
    expect(within(card).getByText('先用 ChatGPT 账号登录，再测试连接')).toBeInTheDocument()
  })
})

const aliyun = () =>
  makePreset({
    id: 'al',
    label: 'Aliyun',
    vendor: { id: 'aliyun', label: '阿里云' },
    // the real preset shape: the placeholder is in the host name
    baseUrl: 'https://{WorkspaceId}.dashscope.aliyuncs.com/compatible-mode/v1',
    baseUrlPlaceholders: ['WorkspaceId'],
    verification: { status: 'documented', source: 'https://help.aliyun.com/x' },
    verifiedAt: undefined,
  })

async function openFill(server: ReturnType<typeof page>['server']) {
  void server
  const section = await screen.findByRole('region', { name: /大模型/ })
  await userEvent.click(within(section).getByRole('button', { name: '添加服务商' }))
  const dialog = await screen.findByRole('dialog', { name: '添加服务商' })
  await userEvent.click(await within(dialog).findByRole('button', { name: /Aliyun/ }))
  return screen.findByRole('dialog', { name: '添加「Aliyun」' })
}

describe('M2: one call creates the provider', () => {
  it('sends one POST with the address filled in, and never a second request', async () => {
    const created = makeKeyProvider({ id: 'prov_new', label: 'Aliyun' })
    const { server } = page({
      providers: [],
      presets: [aliyun()],
      routes: { 'POST /api/providers/from-preset': () => created },
    })
    const fill = await openFill(server)
    await userEvent.type(within(fill).getByRole('textbox', { name: /WorkspaceId/ }), 'ws-42')
    await userEvent.click(within(fill).getByRole('button', { name: '添加' }))
    await waitFor(() =>
      expect(
        server.calls.filter((c) => c.method === 'POST' && c.path === '/api/providers/from-preset'),
      ).toHaveLength(1),
    )
    expect(server.calls.find((c) => c.path === '/api/providers/from-preset')?.body).toEqual({
      presetId: 'al',
      baseUrl: 'https://ws-42.dashscope.aliyuncs.com/compatible-mode/v1',
    })
    expect(server.calls.some((c) => c.method === 'PATCH')).toBe(false)
  })

  it('a placeholder in the path works the same way', async () => {
    const { server } = page({
      providers: [],
      presets: [makePreset({ ...aliyun(), baseUrl: 'https://api.example.com/{WorkspaceId}/v1' })],
      routes: {
        'POST /api/providers/from-preset': () =>
          makeKeyProvider({ id: 'prov_new', label: 'Aliyun' }),
      },
    })
    const fill = await openFill(server)
    await userEvent.type(within(fill).getByRole('textbox', { name: /WorkspaceId/ }), 'ws-42')
    await userEvent.click(within(fill).getByRole('button', { name: '添加' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.path === '/api/providers/from-preset')?.body).toMatchObject(
        { baseUrl: 'https://api.example.com/ws-42/v1' },
      ),
    )
  })

  it('a failure leaves the dialog open and a retry does not create a second provider', async () => {
    let calls = 0
    const { server } = page({
      providers: [],
      presets: [aliyun()],
      routes: {
        'POST /api/providers/from-preset': () => {
          calls++
          return calls === 1
            ? apiError(400, 'BASE_URL_INSECURE')
            : makeKeyProvider({ id: 'prov_new', label: 'Aliyun' })
        },
      },
    })
    const fill = await openFill(server)
    await userEvent.type(within(fill).getByRole('textbox', { name: /WorkspaceId/ }), 'ws-42')
    await userEvent.click(within(fill).getByRole('button', { name: '添加' }))
    expect(await within(fill).findByText(/公网地址请用 https/)).toBeInTheDocument()
    expect(server.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
    await userEvent.click(within(fill).getByRole('button', { name: '添加' }))
    await waitFor(() => expect(calls).toBe(2))
    // the provider list is read from the server; nothing was ever created by a half-finished first attempt
    expect(server.calls.some((c) => c.method === 'PATCH')).toBe(false)
  })

  it('the server saying a placeholder is unfilled points at that input', async () => {
    page({
      providers: [],
      presets: [aliyun()],
      routes: {
        'POST /api/providers/from-preset': () =>
          apiError(400, 'BASE_URL_PLACEHOLDER_UNFILLED', { placeholders: ['WorkspaceId'] }),
      },
    })
    const fill = await openFill({} as never)
    await userEvent.type(within(fill).getByRole('textbox', { name: /WorkspaceId/ }), 'ws-42')
    await userEvent.click(within(fill).getByRole('button', { name: '添加' }))
    const input = within(fill).getByRole('textbox', { name: /WorkspaceId/ })
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
    expect(within(fill).getByText(/要填写 WorkspaceId/)).toBeInTheDocument()
  })

  it('an account-login preset is created without ever sending an address', async () => {
    const { server } = page({
      providers: [],
      presets: [
        makePreset({
          id: 'login',
          label: 'OpenAI login',
          vendor: { id: 'openai', label: 'OpenAI' },
          protocol: 'openai-responses',
          baseUrl: 'https://api.openai.com/v1',
          auth: { type: 'account_login', channel: 'openai-chatgpt' },
          verification: { status: 'documented', source: 'x' },
          verifiedAt: undefined,
        }),
      ],
      routes: { 'POST /api/providers/from-preset': () => makeLoginProvider() },
    })
    const section = await screen.findByRole('region', { name: /大模型/ })
    await userEvent.click(within(section).getByRole('button', { name: '添加服务商' }))
    await userEvent.click(await screen.findByRole('button', { name: /OpenAI login/ }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.path === '/api/providers/from-preset')?.body).toEqual({
        presetId: 'login',
      }),
    )
  })

  it('the model is sent only when the user typed one', async () => {
    const { server } = page({
      providers: [],
      presets: [
        makePreset({
          id: 'lm',
          label: 'LM Studio',
          vendor: { id: 'lmstudio', label: 'LM Studio' },
          baseUrl: 'http://127.0.0.1:1234/v1',
          suggestedModel: '',
          auth: { type: 'none' },
          verification: { status: 'documented', source: 'x' },
          verifiedAt: undefined,
        }),
      ],
      routes: { 'POST /api/providers/from-preset': () => makeKeyProvider({ id: 'prov_new' }) },
    })
    const section = await screen.findByRole('region', { name: /大模型/ })
    await userEvent.click(within(section).getByRole('button', { name: '添加服务商' }))
    await userEvent.click(await screen.findByRole('button', { name: /LM Studio/ }))
    const fill = await screen.findByRole('dialog', { name: '添加「LM Studio」' })
    await userEvent.type(within(fill).getByRole('textbox', { name: /模型/ }), 'llama-3')
    await userEvent.click(within(fill).getByRole('button', { name: '添加' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.path === '/api/providers/from-preset')?.body).toEqual({
        presetId: 'lm',
        model: 'llama-3',
      }),
    )
  })
})

describe('M3: advanced settings follow what each protocol really reads', () => {
  const open = async (p: Record<string, unknown>) => {
    page({ providers: [makeKeyProvider(p)] })
    const card = await screen.findByRole('article', { name: 'DeepSeek' })
    await userEvent.click(within(card).getByRole('button', { name: /展开/ }))
    return card
  }
  it('openai-chat: all three fields and the extra headers; protected fields are model, messages, stream', async () => {
    const card = await open({ protocol: 'openai-chat' })
    expect(within(card).getByRole('textbox', { name: /额外请求体/ })).toBeInTheDocument()
    expect(within(card).getByRole('combobox', { name: /输出长度字段/ })).toBeInTheDocument()
    expect(within(card).getByRole('combobox', { name: /JSON 输出方式/ })).toBeInTheDocument()
    expect(
      within(card).getByText(/model、messages、stream 这些核心字段不会被覆盖/),
    ).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: '加一个请求头' })).toBeInTheDocument()
  })
  it('anthropic-messages: extra body and headers only', async () => {
    const card = await open({ protocol: 'anthropic-messages' })
    expect(within(card).getByRole('textbox', { name: /额外请求体/ })).toBeInTheDocument()
    expect(within(card).queryByRole('combobox', { name: /输出长度字段/ })).toBeNull()
    expect(within(card).queryByRole('combobox', { name: /JSON 输出方式/ })).toBeNull()
    expect(
      within(card).getByText(/model、messages、stream 这些核心字段不会被覆盖/),
    ).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: '加一个请求头' })).toBeInTheDocument()
  })
  it('gemini-chat: protected field is contents', async () => {
    const card = await open({ protocol: 'gemini-chat' })
    expect(within(card).getByText(/contents 这个核心字段不会被覆盖/)).toBeInTheDocument()
    expect(within(card).queryByText(/messages、stream/)).toBeNull()
    expect(within(card).queryByRole('combobox', { name: /JSON 输出方式/ })).toBeNull()
  })
  it('openai-responses: only the extra headers; the rest says it does not apply', async () => {
    const card = await open({ protocol: 'openai-responses' })
    expect(within(card).queryByRole('textbox', { name: /额外请求体/ })).toBeNull()
    expect(within(card).queryByRole('combobox', { name: /输出长度字段/ })).toBeNull()
    expect(within(card).queryByRole('combobox', { name: /JSON 输出方式/ })).toBeNull()
    expect(within(card).getByText(/这个协议只读额外请求头/)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: '加一个请求头' })).toBeInTheDocument()
  })
})

describe('M3 (continued): the advanced panel opens by itself when something in it is wrong', () => {
  const open = async () => {
    const server = page({
      providers: [makeKeyProvider({ protocol: 'anthropic-messages' })],
      routes: {
        'PATCH /api/providers/prov_key': ({ body }) => ({
          ...makeKeyProvider(),
          ...(body as object),
        }),
      },
    }).server
    const card = await screen.findByRole('article', { name: 'DeepSeek' })
    await userEvent.click(within(card).getByRole('button', { name: /展开/ }))
    return { card, server }
  }
  it('invalid JSON: the panel is open, the reason is on the field, and a visible line says why Save is grey', async () => {
    const { card } = await open()
    const details = within(card).getByText('高级设置').closest('details')!
    expect(details.open).toBe(false)
    await userEvent.click(within(card).getByText('高级设置'))
    const box = within(card).getByRole('textbox', { name: /额外请求体/ })
    await userEvent.click(box)
    await userEvent.paste('{oops')
    // collapsing again does not hide the problem
    await userEvent.click(within(card).getByText('高级设置'))
    expect(details.open).toBe(true)
    expect(within(card).getByText('高级设置里有需要改的地方，改好才能保存')).toBeVisible()
    expect(within(card).getByText('这不是合法的 JSON，改好才能保存')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: '保存' })).toBeDisabled()
  })
  it('extra headers: a row is added, saved with the provider, and a protected name blocks saving', async () => {
    const { card, server } = await open()
    await userEvent.click(within(card).getByText('高级设置'))
    await userEvent.click(within(card).getByRole('button', { name: '加一个请求头' }))
    // the first "名称" is the provider's own name field; the header row's is the last one
    const headerName = () => within(card).getAllByRole('textbox', { name: '名称' }).at(-1)!
    await userEvent.type(within(card).getByRole('textbox', { name: '值' }), 'x')
    await userEvent.type(headerName(), 'Authorization')
    expect(await within(card).findByText('这个请求头由 dramai 管理，不能覆盖')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: '保存' })).toBeDisabled()
    await userEvent.clear(headerName())
    await userEvent.type(headerName(), 'anthropic-workspace-id')
    await userEvent.click(within(card).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
        dialect: { extraHeaders: { 'anthropic-workspace-id': 'x' } },
      }),
    )
  })
})

describe('M4: signing out uses the manage link from the contract', () => {
  function setup(
    status: Partial<LoginStatusDto>,
    response: { revoked: 'confirmed' | 'unconfirmed' | 'nothing_to_revoke'; manageUrl?: string },
    provider = makeOpenRouterProvider(status),
  ) {
    const channel =
      (provider.auth as { channel?: LoginStatusDto['channel'] }).channel ?? 'openrouter'
    let current = makeLogin({ channel, ...status })
    const id = provider.id
    const server = fakeServer({
      [`GET /api/providers/${id}/login`]: () => current,
      [`POST /api/providers/${id}/login/logout`]: () => {
        // the real shape: the status is signed out and has no manageUrl; the link is a top-level field
        current = makeLogin({ channel: current.channel, state: 'signed_out' })
        return { status: current, ...response }
      },
      'GET /api/providers': () => ({ items: [] }),
    })
    renderApp(<LoginPanel provider={provider} pollMs={25} />, { client: server.client })
    return server
  }
  it('OpenRouter: the link comes from the logout response', async () => {
    setup(
      {
        state: 'signed_in',
        credential: { kind: 'api_key', mask: 'x' } /* no manageUrl in the status on purpose */,
      },
      { revoked: 'unconfirmed', manageUrl: OR_MANAGE },
    )
    await userEvent.click(await screen.findByRole('button', { name: '登出' }))
    expect(await screen.findByRole('link', { name: /去管理页删除这把 Key/ })).toHaveAttribute(
      'href',
      OR_MANAGE,
    )
  })
  it('OpenAI signed out with no manage link: no link is shown', async () => {
    setup(
      { state: 'signed_in', planUsage: true, account: { label: 'a@b.c' } },
      { revoked: 'confirmed' },
      makeLoginProvider({}, { state: 'signed_in', planUsage: true, account: { label: 'a@b.c' } }),
    )
    await userEvent.click(await screen.findByRole('button', { name: '登出' }))
    expect(await screen.findByText('已登出，OpenAI 端的授权也已撤销')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })
  it('nothing to revoke: no link, even if one were around', async () => {
    setup(
      { state: 'signed_in', credential: { kind: 'api_key', mask: 'x' }, manageUrl: OR_MANAGE },
      { revoked: 'nothing_to_revoke' },
    )
    await userEvent.click(await screen.findByRole('button', { name: '登出' }))
    expect(await screen.findByText('已登出')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /去管理页/ })).toBeNull()
  })
})

describe('F1: a failed connection test explains itself with the same words a failed task uses', () => {
  const run = async (result: unknown, provider: unknown = makeKeyProvider(), name = 'DeepSeek') => {
    page({
      providers: [provider],
      routes: {
        'POST /api/providers/prov_key/test': () => result,
        'POST /api/providers/prov_login/test': () => result,
      },
    })
    const card = await screen.findByRole('article', { name })
    await userEvent.click(within(card).getByRole('button', { name: /展开/ }))
    await userEvent.click(within(card).getByRole('button', { name: /测试连接/ }))
    return { card, notice: await within(card).findByTestId('provider-error') }
  }

  it.each([
    ['HTTP_401', 401, '服务商没有接受这个 Key，或者这个 Key 没有权限'],
    ['HTTP_403', 403, '服务商没有接受这个 Key，或者这个 Key 没有权限'],
    ['HTTP_404', 404, '服务商找不到这个接口或模型'],
    ['HTTP_429', 429, '请求太频繁，或者额度用完了'],
    ['HTTP_502', 502, '服务商那边出错了'],
    ['NETWORK', undefined, '没能连上服务商'],
    ['TIMEOUT', undefined, '服务商太久没有响应'],
    ['UNREADABLE_RESPONSE', 200, '服务商返回的内容不是预期的格式'],
    ['BASE_URL_INVALID', undefined, '接口地址不可用'],
    ['authentication_error', 401, '服务商没有接受这个 Key'],
  ])(
    '%s → a title and a next step, the raw error kept as a detail',
    async (code, status, title) => {
      const { card, notice } = await run({ outcome: 'failed', error: `raw: ${code}`, status, code })
      expect(notice).toHaveTextContent(title)
      expect(within(card).getByText(`raw: ${code}`)).toBeInTheDocument()
      expect(within(card).getByText('技术细节')).toBeInTheDocument()
    },
  )

  it('an HTTP status that has no explanation keeps the plain failure line', async () => {
    page({
      providers: [makeKeyProvider()],
      routes: {
        'POST /api/providers/prov_key/test': () => ({
          outcome: 'failed',
          error: 'teapot',
          status: 418,
          code: 'HTTP_418',
        }),
      },
    })
    const card = await screen.findByRole('article', { name: 'DeepSeek' })
    await userEvent.click(within(card).getByRole('button', { name: /展开/ }))
    await userEvent.click(within(card).getByRole('button', { name: /测试连接/ }))
    expect(await within(card).findByText('连接失败')).toBeInTheDocument()
    expect(within(card).getByText('HTTP 418')).toBeInTheDocument()
    expect(within(card).queryByTestId('provider-error')).toBeNull()
  })

  it('on the settings page there is no "open settings" button; sign-in failures point at the card', async () => {
    const { card, notice } = await run(
      { outcome: 'failed', error: 'sign in', code: 'LOGIN_REQUIRED' },
      makeLoginProvider({}, { state: 'signed_in' }),
      'OpenAI (ChatGPT sign-in)',
    )
    expect(notice).toHaveTextContent('请在这张卡片的登录区域重新登录')
    expect(within(card).queryByRole('button', { name: '去设置服务商' })).toBeNull()
    expect(within(card).queryByRole('link', { name: /去设置服务商/ })).toBeNull()
  })

  it.each([
    ['en', /Expand/, /Test connection/, 'Too many requests, or the quota is used up'],
    ['zh-TW', /展開/, /測試連線/, '請求太頻繁，或者額度用完了'],
  ] as const)('%s has the words too', async (locale, expand, testButton, title) => {
    await useLocale(locale)
    page({
      providers: [makeKeyProvider()],
      routes: {
        'POST /api/providers/prov_key/test': () => ({
          outcome: 'failed',
          error: 'x',
          status: 429,
          code: 'HTTP_429',
        }),
      },
    })
    const card = await screen.findByRole('article', { name: 'DeepSeek' })
    await userEvent.click(within(card).getByRole('button', { name: expand }))
    await userEvent.click(within(card).getByRole('button', { name: testButton }))
    expect(await within(card).findByTestId('provider-error')).toHaveTextContent(title)
  })
})

describe('F3: the four image protocols show up in the catalog and on the card', () => {
  const imagePresets = [
    makePreset({
      id: 'kling-image',
      kind: 'image',
      label: '可灵 图像（Omni，API Key）',
      vendor: { id: 'kling', label: '可灵' },
      region: 'global',
      protocol: 'kling-image',
      baseUrl: 'https://api-singapore.klingai.com',
      suggestedModel: 'kling-image-o1',
      verification: { status: 'documented', source: 'https://kling.ai/document-api' },
      verifiedAt: undefined,
      knownLimitations: ['参考图是不带 data: 前缀的 base64'],
    }),
    makePreset({
      id: 'volc-seedream',
      kind: 'image',
      label: '火山方舟 Seedream',
      vendor: { id: 'volcengine', label: '火山引擎' },
      region: 'cn',
      protocol: 'volcengine-images',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      suggestedModel: 'doubao-seedream-4-0',
    }),
    makePreset({ id: 'llm-only', label: 'A text preset', vendor: { id: 'x', label: 'X' } }),
  ]

  it('the image catalog lists only image presets, with vendor, region and verification status', async () => {
    page({ providers: [], presets: imagePresets })
    const section = await screen.findByRole('region', { name: /文生图/ })
    await userEvent.click(within(section).getByRole('button', { name: '添加服务商' }))
    const dialog = await screen.findByRole('dialog', { name: '添加服务商' })
    const groups = await within(dialog).findAllByRole('region')
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['火山引擎', '可灵'])
    const kling = within(dialog).getByRole('button', { name: /可灵 图像/ })
    expect(kling).toHaveTextContent('国际站')
    expect(kling).toHaveTextContent('按官方文档接入，未实测')
    expect(within(dialog).queryByText('A text preset')).toBeNull()
    // search by vendor id, the way a person would type it
    await userEvent.type(within(dialog).getByRole('searchbox'), 'kling')
    expect(
      within(dialog)
        .getAllByRole('region')
        .map((g) => g.getAttribute('aria-label')),
    ).toEqual(['可灵'])
  })

  it('a card shows the protocol name and what the capability grid claims, with the server’s note under it', async () => {
    const capability = makeCapabilityView()
    const view = {
      ...capability,
      capability: {
        ...capability.capability,
        media: 'image' as const,
        modes: { t2i: 'supported' as const },
        refImages: { support: 'supported' as const, value: 10, note: '官方声称，未验证' },
      },
    }
    page({
      providers: [
        makeKeyProvider({
          id: 'prov_img',
          kind: 'image',
          label: '可灵 图像',
          protocol: 'kling-image',
          baseUrl: 'https://api-singapore.klingai.com',
          model: 'kling-image-o1',
        }),
      ],
      routes: { 'GET /api/providers/prov_img/capability': () => view },
    })
    const card = await screen.findByRole('article', { name: '可灵 图像' })
    expect(card).toHaveTextContent('可灵（生图）')
    await userEvent.click(within(card).getByRole('button', { name: /展开/ }))
    expect(await within(card).findByText('官方声称，未验证')).toBeInTheDocument()
    expect(within(card).getByText('上限 10 张')).toBeInTheDocument()
  })
})

describe('suggestions: values, links, focus and failures', () => {
  it('placeholder values: dots, edge hyphens and separators are refused; real ids pass', () => {
    const preset = aliyun() as unknown as Parameters<typeof inputProblems>[0]
    const verdict = (v: string) => inputProblems(preset, { WorkspaceId: v }, '').length === 0
    for (const bad of ['.', '..', '-a', 'a-', '.a', 'a.', 'a b', 'a/b', 'a@b', 'a:80', 'a?b'])
      expect(verdict(bad), bad).toBe(false)
    for (const ok of ['a', 'ws-42', 'my.ws', 'A1_b~c', '0123456789abcdef'])
      expect(verdict(ok), ok).toBe(true)
  })

  it('only http and https links from the server are ever used', () => {
    expect(safeHttpUrl('https://openrouter.ai/settings/keys')).toBe(
      'https://openrouter.ai/settings/keys',
    )
    expect(safeHttpUrl('http://127.0.0.1:1455/x')).toBe('http://127.0.0.1:1455/x')
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
      'nope',
      '',
      undefined,
    ])
      expect(safeHttpUrl(bad), String(bad)).toBeUndefined()
  })

  it('an authorization address that is not http(s) is not opened, and the user is told', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const status = makeLogin({ state: 'signed_out' })
    const server = fakeServer({
      'GET /api/providers/prov_login/login': () => status,
      'POST /api/providers/prov_login/login/start': () => ({
        authorizationUrl: 'javascript:alert(1)',
        redirectUri: 'http://127.0.0.1:1455/auth/callback',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      }),
      'GET /api/providers': () => ({ items: [] }),
    })
    renderApp(
      <LoginPanel provider={makeLoginProvider({}, { state: 'signed_out' })} pollMs={25} />,
      {
        client: server.client,
      },
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with ChatGPT' }))
    expect(await screen.findByText(/不是 http 或 https 网址，没有打开/)).toBeInTheDocument()
    expect(open).not.toHaveBeenCalled()
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull()
  })

  it('a manage link that is not http(s) is not rendered', async () => {
    const provider = makeOpenRouterProvider({ state: 'signed_in' })
    let current = makeLogin({
      channel: 'openrouter',
      state: 'signed_in',
      credential: { kind: 'api_key', mask: 'x' },
    })
    const server = fakeServer({
      'GET /api/providers/prov_or/login': () => current,
      'POST /api/providers/prov_or/login/logout': () => {
        current = makeLogin({ channel: 'openrouter', state: 'signed_out' })
        return { status: current, revoked: 'unconfirmed', manageUrl: 'javascript:alert(1)' }
      },
      'GET /api/providers': () => ({ items: [] }),
    })
    renderApp(<LoginPanel provider={provider} pollMs={25} />, { client: server.client })
    await userEvent.click(await screen.findByRole('button', { name: '登出' }))
    expect(await screen.findByText(/本机的 Key 已清除/)).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('moving to the second step puts the focus on its first field', async () => {
    const { server } = page({ providers: [], presets: [aliyun()] })
    const fill = await openFill(server)
    const field = within(fill).getByRole('textbox', { name: /WorkspaceId/ })
    await waitFor(() => expect(field).toHaveFocus())
  })

  it('a failed sign-in status query shows the error and a retry, and the panel comes back', async () => {
    let fail = true
    const server = fakeServer({
      'GET /api/providers/prov_login/login': () =>
        fail ? apiError(500, 'INTERNAL') : makeLogin({ state: 'signed_out' }),
      'GET /api/providers': () => ({ items: [] }),
    })
    renderApp(
      <LoginPanel
        provider={{ ...makeLoginProvider({}, { state: 'signed_out' }), login: undefined }}
        pollMs={25}
      />,
      {
        client: server.client,
      },
    )
    const box = await screen.findByTestId('login-panel-error')
    expect(within(box).getByRole('button', { name: '重试' })).toBeInTheDocument()
    fail = false
    await userEvent.click(within(box).getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('button', { name: 'Continue with ChatGPT' })).toBeInTheDocument()
    expect(screen.queryByTestId('login-panel-error')).toBeNull()
  })

  it('the model field’s label is translated, not hard-coded', async () => {
    await useLocale('en')
    page({ providers: [makeKeyProvider()] })
    const card = await screen.findByRole('article', { name: 'DeepSeek' })
    await userEvent.click(within(card).getByRole('button', { name: /Expand/ }))
    expect(within(card).getByRole('textbox', { name: 'Model' })).toBeInTheDocument()
    await useLocale('zh-CN')
  })
})

describe('Traditional Chinese wording', () => {
  it('uses Taiwan terms, not converted Mainland ones, in the provider copy', () => {
    const text = JSON.stringify([
      zhTW.providerAuth,
      zhTW.providerLogin,
      zhTW.providerErrors,
      zhTW.providerCatalog,
      zhTW.providerDialect,
    ])
    for (const wrong of ['許可權', '回撥', '賬', '文本', '響應', '反饋'])
      expect(text, wrong).not.toContain(wrong)
    for (const right of ['權限', '回呼', '帳號'])
      expect(JSON.stringify(zhTW), right).toContain(right)
  })
})
