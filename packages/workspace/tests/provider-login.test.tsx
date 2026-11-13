import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoginStatusDto } from '@dramai/api'
import { LoginPanel } from '@/features/settings/LoginPanel'
import { CHANNELS } from '@/features/settings/login-channels'
import { fakeServer } from './fixtures'
import { makeLogin, makeLoginProvider } from './fixtures-providers'
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

const URL_ = 'https://auth.openai.com/oauth/authorize?x=1'

/** A fake sign-in server whose status the test can move along. */
function setup(initial: Partial<LoginStatusDto> = {}, over: Parameters<typeof fakeServer>[0] = {}) {
  const state = { status: makeLogin(initial) }
  const server = fakeServer({
    'GET /api/providers/prov_login/login': () => state.status,
    // the server is waiting for the browser as soon as a sign-in starts
    'POST /api/providers/prov_login/login/start': () => {
      state.status = makeLogin(pending())
      return {
        authorizationUrl: URL_,
        redirectUri: 'http://127.0.0.1:1455/auth/callback',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      }
    },
    'POST /api/providers/prov_login/login/cancel': () => {
      state.status = makeLogin({ state: 'signed_out' })
      return state.status
    },
    'POST /api/providers/prov_login/login/logout': () => {
      state.status = makeLogin({ state: 'signed_out', account: { label: 'a@b.c' } })
      return { status: state.status, revoked: 'confirmed' }
    },
    'GET /api/providers': () => ({ items: [] }),
    ...over,
  })
  const provider = makeLoginProvider({}, initial)
  const view = renderApp(<LoginPanel provider={provider} pollMs={25} />, { client: server.client })
  return { ...view, server, state }
}

const pending = (extra: Partial<LoginStatusDto> = {}): Partial<LoginStatusDto> => ({
  state: 'pending',
  pending: { expiresAt: new Date(Date.now() + 600_000).toISOString() },
  ...extra,
})

describe('sign-in states', () => {
  it('signed out: only “Continue with ChatGPT”, and it says login covers text only', async () => {
    setup()
    expect(await screen.findByRole('button', { name: 'Continue with ChatGPT' })).toBeInTheDocument()
    expect(screen.getByText(/只覆盖文本/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '换账号' })).toBeNull()
    expect(screen.queryByRole('button', { name: '登出' })).toBeNull()
  })

  it('signed out but an account was used before: continue with it, or switch account', async () => {
    const { server } = setup({ account: { label: 'me@example.com' } })
    expect(await screen.findByText(/上次登录的账号：me@example.com/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '换账号' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.path.endsWith('/login/start'))?.body).toEqual({
        account: 'new',
      }),
    )
  })

  it('signed in: account, “Using ChatGPT plan” with a Manage usage link, sign out', async () => {
    setup({
      state: 'signed_in',
      planUsage: true,
      account: { label: 'me@example.com' },
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    })
    expect(await screen.findByText('已登录：me@example.com')).toBeInTheDocument()
    expect(screen.getByText('正在使用 ChatGPT 套餐')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /管理用量/ })).toHaveAttribute(
      'href',
      'https://chatgpt.com/settings/usage',
    )
    expect(screen.getByRole('button', { name: '登出' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue with ChatGPT' })).toBeNull()
  })

  it('signed in without the plan-usage scope: says it cannot be used and asks to sign in again and approve', async () => {
    const { server } = setup({
      state: 'signed_in',
      planUsage: false,
      account: { label: 'me@example.com' },
    })
    expect(await screen.findByText('已登录，但还不能用')).toBeInTheDocument()
    expect(screen.queryByText('正在使用 ChatGPT 套餐')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '重新登录并同意授权' }))
    await waitFor(() =>
      expect(server.calls.some((c) => c.path.endsWith('/login/start'))).toBe(true),
    )
  })

  it('needs sign-in again: says why and offers the sign-in button', async () => {
    setup({ state: 'needs_relogin', account: { label: 'me@example.com' } })
    expect(await screen.findByText('登录已失效，需要重新登录')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue with ChatGPT' })).toBeInTheDocument()
  })

  it('from another machine: no sign-in button, the reason is written', async () => {
    setup({ availability: { available: false, reason: 'remote_access', message: '服务端的原文' } })
    expect(await screen.findByText(/从别的机器访问的/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue with ChatGPT' })).toBeNull()
  })

  it('a rejected token refresh while signed in is a hint, not a sign-out', async () => {
    setup({
      state: 'signed_in',
      planUsage: true,
      account: { label: 'a@b.c' },
      lastError: { code: 'refresh_rejected', message: 'x', at: '2026-11-13T00:00:00Z' },
    })
    expect(await screen.findByText(/拒绝了一次令牌刷新/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '登出' })).toBeInTheDocument()
  })
})

describe('sign-in errors', () => {
  const err = (code: string): Partial<LoginStatusDto> => ({
    lastError: { code: code as never, message: 'server text', at: '2026-11-13T00:00:00Z' },
  })
  it.each([
    ['user_denied', /你在授权页拒绝了登录/],
    ['timeout', /登录超时了/],
    ['account_mismatch', /不是同一个/],
    ['cancelled', /登录已取消/],
  ])('%s is explained in words, with the button to try again', async (code, text) => {
    setup(err(code))
    expect(await screen.findByText(text)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue with ChatGPT' })).toBeInTheDocument()
  })

  it.each([
    'state_mismatch',
    'nonce_mismatch',
    'bad_signature',
    'issuer_mismatch',
    'audience_mismatch',
    'expired',
    'bad_id_token',
    'client_mismatch',
    'registration_incomplete',
    'invalid_grant',
    'no_code',
    'authorization_error',
    'exchange_failed',
  ])('%s is one generic “try again” with the technical detail folded away', async (code) => {
    setup(err(code))
    expect(await screen.findByText('登录没有完成，请重试')).toBeInTheDocument()
    expect(screen.getByText('技术详情')).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`${code}: server text`))).toBeInTheDocument()
    expect(screen.queryByText(/忽略/)).toBeNull() // validation failures never invite "ignore"
  })
})

describe('the sign-in flow', () => {
  it('starts, opens the authorization page in a new window, waits, and says it is signed in when it is', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { server, state } = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with ChatGPT' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith(URL_, '_blank', 'noopener,noreferrer'))
    expect(server.calls.find((c) => c.path.endsWith('/login/start'))?.body).toEqual({})

    expect(await screen.findByText('请在浏览器里完成授权')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '等待授权' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消登录' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue with ChatGPT' })).toBeNull() // no second sign-in while pending
    expect(screen.getByRole('link', { name: /重新打开授权页/ })).toHaveAttribute('href', URL_)

    // the browser finished
    state.status = makeLogin({
      state: 'signed_in',
      planUsage: true,
      account: { label: 'me@example.com' },
    })
    expect(await screen.findByText('已登录：me@example.com')).toBeInTheDocument()
    open.mockRestore()
  })

  it('the first successful sign-in shows the one-time “You’re using your ChatGPT plan” note, later ones do not', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null)
    const first = setup(pending())
    await screen.findByText('请在浏览器里完成授权')
    first.state.status = makeLogin({
      state: 'signed_in',
      planUsage: true,
      account: { label: 'a@b.c' },
    })
    const dialog = await screen.findByRole('dialog', { name: '你正在使用你的 ChatGPT 套餐' })
    expect(within(dialog).getByText(/可以在 ChatGPT 设置中管理用量/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: '知道了' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(localStorage.getItem(CHANNELS['openai-chatgpt'].welcome!.flag)).toBe('1')
    first.unmount()

    const second = setup(pending())
    await screen.findByText('请在浏览器里完成授权')
    second.state.status = makeLogin({
      state: 'signed_in',
      planUsage: true,
      account: { label: 'a@b.c' },
    })
    await screen.findByText('已登录：a@b.c')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a sign-in without plan usage does not show the welcome note', async () => {
    const { state } = setup(pending())
    await screen.findByText('请在浏览器里完成授权')
    state.status = makeLogin({ state: 'signed_in', planUsage: false, account: { label: 'a@b.c' } })
    await screen.findByText('已登录，但还不能用')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('cancelling asks the server to cancel and polling stops', async () => {
    const { server } = setup(pending())
    await userEvent.click(await screen.findByRole('button', { name: '取消登录' }))
    await waitFor(() =>
      expect(server.calls.some((c) => c.path.endsWith('/login/cancel'))).toBe(true),
    )
    expect(await screen.findByRole('button', { name: 'Continue with ChatGPT' })).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 60)) // let any in-flight poll land
    const polls = () =>
      server.calls.filter((c) => c.method === 'GET' && c.path.endsWith('/login')).length
    const after = polls()
    await new Promise((r) => setTimeout(r, 200)) // eight poll intervals
    expect(polls()).toBe(after)
  })

  it('polls while pending, and stops when the component goes away', async () => {
    const { server, unmount } = setup(pending())
    const polls = () =>
      server.calls.filter((c) => c.method === 'GET' && c.path.endsWith('/login')).length
    await waitFor(() => expect(polls()).toBeGreaterThanOrEqual(3))
    unmount()
    await new Promise((r) => setTimeout(r, 60))
    const after = polls()
    await new Promise((r) => setTimeout(r, 200))
    expect(polls()).toBe(after)
  })

  it('does not poll at all when not waiting for a sign-in', async () => {
    const { server } = setup({ state: 'signed_in', planUsage: true, account: { label: 'a@b.c' } })
    await screen.findByText('已登录：a@b.c')
    await new Promise((r) => setTimeout(r, 200))
    expect(
      server.calls.filter((c) => c.method === 'GET' && c.path.endsWith('/login')),
    ).toHaveLength(0)
  })

  it('a start that the server refuses is explained (callback cannot reach this machine)', async () => {
    const { apiError } = await import('./fixtures')
    setup(
      {},
      {
        'POST /api/providers/prov_login/login/start': () =>
          apiError(409, 'LOGIN_UNAVAILABLE_REMOTE'),
      },
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with ChatGPT' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('授权回调到不了这里')
  })
})

describe('signing out', () => {
  const signedIn: Partial<LoginStatusDto> = {
    state: 'signed_in',
    planUsage: true,
    account: { label: 'a@b.c' },
  }
  it('confirmed revoke: says OpenAI’s authorization was revoked too', async () => {
    setup(signedIn)
    await userEvent.click(await screen.findByRole('button', { name: '登出' }))
    expect(await screen.findByText('已登出，OpenAI 端的授权也已撤销')).toBeInTheDocument()
  })

  it('unconfirmed revoke: says so honestly and points to ChatGPT settings', async () => {
    let status: LoginStatusDto = makeLogin(signedIn)
    setup(signedIn, {
      'GET /api/providers/prov_login/login': () => status,
      'POST /api/providers/prov_login/login/logout': () => {
        status = makeLogin({ state: 'signed_out', account: { label: 'a@b.c' } })
        return { status, revoked: 'unconfirmed' }
      },
    })
    await userEvent.click(await screen.findByRole('button', { name: '登出' }))
    expect(await screen.findByText(/没能确认 OpenAI 端已撤销/)).toBeInTheDocument()
    expect(screen.getByText(/到 ChatGPT 设置里断开这个应用/)).toBeInTheDocument()
  })
})

describe('English', () => {
  it('uses OpenAI’s wording for the button, the plan note and the welcome text', async () => {
    await useLocale('en')
    setup({ state: 'signed_in', planUsage: true, account: { label: 'a@b.c' } })
    expect(await screen.findByText('Using ChatGPT plan')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Manage usage/ })).toBeInTheDocument()
    await useLocale('zh-CN')
  })
})
