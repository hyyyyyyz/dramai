import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROVIDER_ERROR_CODES } from '@/features/settings/provider-model'
import { PlanUsageNote } from '@/features/common/PlanUsageNote'
import { TaskItem } from '@/features/jobs/TaskItem'
import { ProvidersPage } from '@/features/settings/ProvidersPage'
import { failedJob, fakeServer } from './fixtures'
import { makeCapabilityView } from './fixtures-production'
import { makeKeyProvider, makeLoginProvider } from './fixtures-providers'
import { renderApp, useLocale } from './render'
import zh from '@/i18n/locales/zh-CN'
import zhTW from '@/i18n/locales/zh-TW'
import en from '@/i18n/locales/en'

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

const noKey = () =>
  makeKeyProvider({ id: 'prov_nokey', label: '没填 Key 的', hasKey: false, keyMask: undefined })
const local = () =>
  makeKeyProvider({
    id: 'prov_local',
    label: '本机模型',
    baseUrl: 'http://127.0.0.1:11434/v1',
    auth: { type: 'none' },
    hasKey: false,
    keyMask: undefined,
    verification: { status: 'documented', source: 'Ollama docs' },
  })

function page(opts: {
  providers: unknown[]
  presets?: unknown[]
  active?: Record<string, string>
  routes?: Parameters<typeof fakeServer>[0]
}) {
  const settings = { activeProviders: opts.active ?? {}, cost: {} }
  const server = fakeServer({
    'GET /api/providers': () => ({ items: opts.providers }),
    'GET /api/settings': () => settings,
    'PUT /api/settings': ({ body }) => body,
    'GET /api/projects': () => ({ items: [] }),
    'GET /api/presets': () => ({ items: opts.presets ?? [] }),
    'GET /api/providers/prov_login/capability': () => makeCapabilityView(),
    'GET /api/providers/prov_key/capability': () => makeCapabilityView(),
    'GET /api/providers/prov_nokey/capability': () => makeCapabilityView(),
    'GET /api/providers/prov_local/capability': () => makeCapabilityView(),
    ...opts.routes,
  })
  const view = renderApp(<ProvidersPage />, { client: server.client })
  return { ...view, server }
}

const card = (name: string) => screen.findByRole('article', { name })

describe('how a provider authenticates', () => {
  it('“no API key yet”, “needs no authentication” and “signed in with an account” read differently', async () => {
    page({
      providers: [
        noKey(),
        local(),
        makeLoginProvider({}, { state: 'signed_in', planUsage: true, account: { label: 'a@b.c' } }),
        makeKeyProvider(),
      ],
    })
    const missing = await card('没填 Key 的')
    expect(within(missing).getByText('还没有 API Key')).toBeInTheDocument()
    const none = await card('本机模型')
    expect(within(none).getByText('无需鉴权')).toBeInTheDocument()
    expect(within(none).queryByText('还没有 API Key')).toBeNull()
    const login = await card('OpenAI (ChatGPT sign-in)')
    expect(within(login).getByText('ChatGPT 账号登录')).toBeInTheDocument()
    const keyed = await card('DeepSeek')
    expect(within(keyed).getByText('API Key')).toBeInTheDocument()
  })

  it('verification: tested shows its date, documented-only says not tested and shows the source', async () => {
    page({ providers: [makeKeyProvider(), makeLoginProvider()] })
    expect(within(await card('DeepSeek')).getByText('已实测 · 2026-05-04')).toBeInTheDocument()
    const doc = await card('OpenAI (ChatGPT sign-in)')
    expect(within(doc).getByText('按官方文档接入，未实测')).toBeInTheDocument()
    await userEvent.click(within(doc).getByRole('button', { name: /展开/ }))
    expect(
      within(doc).getByRole('link', { name: 'https://developers.openai.com/siwc' }),
    ).toHaveAttribute('href', 'https://developers.openai.com/siwc')
    expect(within(doc).getByText(/它不会自动成为当前选择/)).toBeInTheDocument()
  })

  it('an account-login provider shows no key field and a read-only address and protocol', async () => {
    page({ providers: [makeLoginProvider({}, { state: 'signed_out' })] })
    const c = await card('OpenAI (ChatGPT sign-in)')
    await userEvent.click(within(c).getByRole('button', { name: /展开/ }))
    expect(within(c).queryByText('API Key')).toBeNull()
    expect(within(c).queryByPlaceholderText('粘贴新的 Key')).toBeNull()
    expect(within(c).getByRole('textbox', { name: 'Base URL' })).toHaveAttribute('readonly')
    expect(within(c).getByRole('combobox', { name: /API 协议/ })).toBeDisabled()
    expect(within(c).getByText(/接口地址和协议是固定的/)).toBeInTheDocument()
    expect(within(c).getByRole('button', { name: 'Continue with ChatGPT' })).toBeInTheDocument()
    // testing needs a sign-in first
    expect(within(c).getByRole('button', { name: /测试连接/ })).toBeDisabled()
  })

  it('a provider that needs no authentication says so instead of asking for a key', async () => {
    page({ providers: [local()] })
    const c = await card('本机模型')
    await userEvent.click(within(c).getByRole('button', { name: /展开/ }))
    expect(within(c).getByText(/不需要鉴权/)).toBeInTheDocument()
    expect(within(c).queryByRole('button', { name: '保存 Key' })).toBeNull()
    expect(within(c).getByRole('button', { name: /测试连接/ })).toBeEnabled()
  })

  it('signed in: the model is chosen from what the account can use', async () => {
    const { server } = page({
      providers: [
        makeLoginProvider(
          { model: 'gpt-5' },
          { state: 'signed_in', planUsage: true, account: { label: 'a@b.c' } },
        ),
      ],
      routes: {
        'GET /api/providers/prov_login/models': () => ({
          items: [
            { id: 'gpt-5', label: 'GPT-5' },
            { id: 'gpt-5-mini', label: 'GPT-5 mini' },
          ],
        }),
      },
    })
    const c = await card('OpenAI (ChatGPT sign-in)')
    await userEvent.click(within(c).getByRole('button', { name: /展开/ }))
    const select = await within(c).findByRole('combobox', { name: '模型' })
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['GPT-5 (gpt-5)', 'GPT-5 mini (gpt-5-mini)'])
    expect(server.calls.some((x) => x.path.endsWith('/models'))).toBe(true)
  })
})

describe('when a task fails because of the account sign-in', () => {
  const item = (code: string) =>
    renderApp(
      <ul>
        <TaskItem
          job={failedJob('generation_failed', {
            error: { category: 'generation_failed', code, message: 'raw', recoverable: false },
          })}
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

  it('LOGIN_REQUIRED asks to sign in again and goes to the settings', () => {
    item('LOGIN_REQUIRED')
    expect(screen.getByText('需要重新登录服务商账号')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去设置服务商' })).toHaveAttribute(
      'href',
      '/settings/providers',
    )
  })

  it('a usage limit says so, makes “Manage usage” the main action and does not guess a reset time', () => {
    item('subscription_sharing_usage_limit_exceeded')
    expect(screen.getByText('已达到用量上限')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '管理用量' })).toHaveAttribute(
      'href',
      'https://chatgpt.com/settings/usage',
    )
    expect(screen.getByText(/不会猜什么时候重置/)).toBeInTheDocument()
  })

  it('an account that cannot share its plan: do not retry, change account or use an API key', () => {
    item('subscription_sharing_user_not_eligible')
    expect(screen.getByText(/重试也没用/)).toBeInTheDocument()
    expect(screen.getByText(/改用 API Key/)).toBeInTheDocument()
  })

  it('temporary outages say the sign-in is still valid', () => {
    item('subscription_sharing_usage_unavailable')
    expect(screen.getByText(/登录凭据仍然有效/)).toBeInTheDocument()
  })

  it('an unrelated error code gets no extra block', () => {
    item('HTTP_500')
    expect(screen.queryByTestId('provider-error')).toBeNull()
  })
})

describe('“Using ChatGPT plan” near the places that use it', () => {
  const run = (providers: unknown[], active: string | undefined) => {
    const server = fakeServer({
      'GET /api/providers': () => ({ items: providers }),
      'GET /api/settings': () => ({ activeProviders: active ? { llm: active } : {}, cost: {} }),
    })
    return renderApp(<PlanUsageNote />, { client: server.client })
  }
  it('shown when the language model in use is the signed-in ChatGPT account', async () => {
    run(
      [makeLoginProvider({}, { state: 'signed_in', planUsage: true, account: { label: 'a@b.c' } })],
      'prov_login',
    )
    expect(await screen.findByText('正在使用 ChatGPT 套餐')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /管理用量/ })).toBeInTheDocument()
  })
  it('not shown for an API-key provider, or when the account is signed out', async () => {
    run([makeKeyProvider(), makeLoginProvider({}, { state: 'signed_out' })], 'prov_key')
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByText('正在使用 ChatGPT 套餐')).toBeNull()
  })
  it('not shown when the signed-in account is not the one in use', async () => {
    run(
      [
        makeKeyProvider(),
        makeLoginProvider({}, { state: 'signed_in', planUsage: true, account: { label: 'x' } }),
      ],
      'prov_key',
    )
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByText('正在使用 ChatGPT 套餐')).toBeNull()
  })
})

describe('copy exists in every language', () => {
  const langs = { 'zh-CN': zh, 'zh-TW': zhTW, en } as const
  it('every task/test error code has a title and body, and the six new API codes have copy', () => {
    for (const [name, dict] of Object.entries(langs)) {
      for (const code of PROVIDER_ERROR_CODES) {
        const e = (
          dict.providerErrors as unknown as Record<string, { title: string; body: string }>
        )[code]
        expect(e?.title, `${name} ${code} title`).toBeTruthy()
        expect(e?.body, `${name} ${code} body`).toBeTruthy()
      }
      for (const code of [
        'PROVIDER_REQUEST_FAILED',
        'LOGIN_NOT_SUPPORTED',
        'LOGIN_UNAVAILABLE_REMOTE',
        'KEY_NOT_APPLICABLE',
        'AUTH_NOT_ALLOWED',
        'MODEL_LIST_UNSUPPORTED',
      ]) {
        expect(dict.errors, `${name} ${code}`).toHaveProperty(code)
      }
      for (const k of ['denied', 'timeout', 'account_mismatch', 'cancelled', 'failed', 'details']) {
        expect(dict.providerLogin.errors, `${name} login error ${k}`).toHaveProperty(k)
      }
    }
  })
})
