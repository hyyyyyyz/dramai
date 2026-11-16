import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoginStatusDto } from '@dramai/api'
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

describe('F3: the four image protocols show up on the card', () => {
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
      zhTW.providers.add,
      zhTW.providerDialect,
    ])
    for (const wrong of ['許可權', '回撥', '賬', '文本', '響應', '反饋'])
      expect(text, wrong).not.toContain(wrong)
    for (const right of ['權限', '回呼', '帳號'])
      expect(JSON.stringify(zhTW), right).toContain(right)
  })
})
