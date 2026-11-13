import { createHash, randomBytes } from 'node:crypto'
import type { SecretStore } from '../../ports/index.ts'
import { assertLoginEndpoint, LoginRequiredError } from '../auth.ts'
import type { ProviderConfig } from '../types.ts'
import type {
  ListenerFactory,
  LoginErrorCode,
  LoginService,
  LoginStatus,
  LoopbackListener,
} from './types.ts'

/**
 * OpenRouter 账号登录（OAuth PKCE）。依据：官方文档 https://openrouter.ai/docs/guides/overview/auth/oauth（2026-11 核对）。
 *
 * - **不需要注册客户端，没有密钥**；授权地址 `https://openrouter.ai/auth`，参数 `callback_url`、`code_challenge`、
 *   `code_challenge_method=S256`、`key_label`、`state`（授权成功后原样带回；拒绝时不带）。
 * - **回调只写了 `localhost`**（任意端口，文档示例 `http://localhost:51423/callback`），文档没提 `127.0.0.1`，所以这里用
 *   `localhost`，不去猜别的形式。监听器同时绑 127.0.0.1 和 ::1，不管浏览器把 localhost 解析到哪个都能到。
 * - 换码：`POST https://openrouter.ai/api/v1/auth/keys`，JSON `{ code, code_verifier, code_challenge_method }`，
 *   返回 `{ key }`——**用户自己的一把 OpenRouter API Key**。授权码 10 分钟过期。错误：400 挑战方法不一致、
 *   403 码或校验值无效 / 过期、405 必须 HTTPS POST。
 * - 换回的是普通的 API Key：**没有有效期、没有刷新**（文档没写）；存进 SecretStore 后，调用和 API Key 方式完全一样。
 * - **没有撤销 / 删除 Key 的接口**（文档没写）：登出只清本机的 Key，如实返回 `unconfirmed`，并给出 Key 管理页面
 *   `https://openrouter.ai/keys/<Key 的 SHA-256 小写十六进制>`（官方文档的深链接）让用户自己作废。
 * - 标准和 OpenAI 通道一致：每次新的 state 和 PKCE verifier；state 先于一切校验，**state 不符的请求只回 400、
 *   不结束这次登录**；取消 / 超时后换码请求还在途中，结果丢弃、不保存；只发到官方地址（见 `assertLoginEndpoint`）。
 */

export const OPENROUTER_LOGIN = {
  authorizeUrl: 'https://openrouter.ai/auth',
  exchangeUrl: 'https://openrouter.ai/api/v1/auth/keys',
  callbackPath: '/callback',
  keysPage: 'https://openrouter.ai/keys/',
  keyLabel: 'dramai',
} as const

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface OpenRouterLoginDeps {
  secrets: SecretStore
  listen: ListenerFactory
  fetch?: FetchLike
  now?: () => number
  log?: (event: { event: string; providerId?: string; code?: string; detail?: string }) => void
  loginTimeoutMs?: number
}

interface Pending {
  providerId: string
  state: string
  verifier: string
  listener: LoopbackListener
  timer: ReturnType<typeof setTimeout>
  expiresAt: number
  settled: boolean
}

class OpenRouterLoginError extends Error {
  readonly code: LoginErrorCode
  constructor(code: LoginErrorCode, message: string) {
    super(message)
    this.name = 'OpenRouterLoginError'
    this.code = code
  }
}

const b64url = (buf: Buffer) => buf.toString('base64url')

/** 官方深链接：Key 管理页面（小写十六进制的 SHA-256）。只对 Key 的主人有效。 */
export const openRouterKeyPage = (key: string): string =>
  `${OPENROUTER_LOGIN.keysPage}${createHash('sha256').update(key).digest('hex')}`

/** 给界面看的掩码，不是 Key。 */
export const maskKey = (key: string): string =>
  key.length >= 16 ? `${key.slice(0, 6)}…${key.slice(-4)}` : '••••••••'

export class OpenRouterLogin implements LoginService {
  readonly id = 'openrouter' as const
  private readonly d: OpenRouterLoginDeps
  private readonly pending = new Map<string, Pending>()
  private readonly lastError = new Map<string, NonNullable<LoginStatus['lastError']>>()

  constructor(deps: OpenRouterLoginDeps) {
    this.d = deps
  }

  private now = () => (this.d.now ?? Date.now)()
  private doFetch: FetchLike = (url, init) => (this.d.fetch ?? fetch)(url, init)
  private log = (e: Parameters<NonNullable<OpenRouterLoginDeps['log']>>[0]) => this.d.log?.(e)

  async start(providerId: string, secretRef: string) {
    this.cancel(providerId)
    const state = b64url(randomBytes(24))
    const verifier = b64url(randomBytes(32))
    // 先起监听器，再给出地址
    const listener = await this.d.listen(
      (params) => this.onCallback(providerId, secretRef, params),
      {
        host: 'localhost',
        path: OPENROUTER_LOGIN.callbackPath,
        preferredPort: 0,
      },
    )
    const timeoutMs = this.d.loginTimeoutMs ?? 10 * 60_000
    const p: Pending = {
      providerId,
      state,
      verifier,
      listener,
      expiresAt: this.now() + timeoutMs,
      settled: false,
      timer: setTimeout(
        () => this.fail(p, new OpenRouterLoginError('timeout', '登录超时，请重新发起')),
        timeoutMs,
      ),
    }
    p.timer.unref?.()
    this.pending.set(providerId, p)
    this.lastError.delete(providerId)

    const q = new URLSearchParams()
    q.set('callback_url', listener.redirectUri)
    q.set('code_challenge', b64url(createHash('sha256').update(verifier).digest()))
    q.set('code_challenge_method', 'S256')
    q.set('key_label', OPENROUTER_LOGIN.keyLabel)
    q.set('state', state)
    this.log({ event: 'login.start', providerId, detail: 'openrouter' })
    return {
      authorizationUrl: `${OPENROUTER_LOGIN.authorizeUrl}?${q.toString()}`,
      redirectUri: listener.redirectUri,
      expiresAt: new Date(p.expiresAt).toISOString(),
    }
  }

  cancel(providerId: string): boolean {
    const p = this.pending.get(providerId)
    if (!p) return false
    this.settle(p)
    this.log({ event: 'login.cancel', providerId, code: 'cancelled' })
    return true
  }

  private settle(p: Pending): void {
    p.settled = true
    clearTimeout(p.timer)
    try {
      p.listener.close()
    } catch {
      /* already closed */
    }
    if (this.pending.get(p.providerId) === p) this.pending.delete(p.providerId)
  }

  private fail(p: Pending, err: OpenRouterLoginError): void {
    if (p.settled) return // 只结束"这一次"登录
    this.settle(p)
    this.lastError.set(p.providerId, {
      code: err.code,
      message: err.message,
      at: new Date(this.now()).toISOString(),
    })
    this.log({ event: 'login.failed', providerId: p.providerId, code: err.code })
  }

  private async onCallback(
    providerId: string,
    secretRef: string,
    params: URLSearchParams,
  ): Promise<{ ok: boolean; error?: LoginErrorCode }> {
    const p = this.pending.get(providerId)
    if (!p || p.settled) return { ok: false, error: 'cancelled' }
    // state 不符（含没带 state：官方说拒绝时不回传）的请求不是这次登录的回调，只拒绝它，继续等
    if (params.get('state') !== p.state) {
      this.log({ event: 'login.callback_ignored', providerId, code: 'state_mismatch' })
      return { ok: false, error: 'state_mismatch' }
    }
    try {
      await this.complete(p, secretRef, params)
      this.settle(p)
      this.lastError.delete(providerId)
      this.log({ event: 'login.completed', providerId })
      return { ok: true }
    } catch (err) {
      if (p.settled) return { ok: false, error: 'cancelled' }
      const e =
        err instanceof OpenRouterLoginError
          ? err
          : new OpenRouterLoginError('exchange_failed', '登录没有完成，请重试')
      this.fail(p, e)
      return { ok: false, error: e.code }
    }
  }

  private async complete(p: Pending, secretRef: string, q: URLSearchParams): Promise<void> {
    const error = q.get('error')
    if (error) {
      throw new OpenRouterLoginError(
        error === 'access_denied' ? 'user_denied' : 'authorization_error',
        error === 'access_denied' ? '你在授权页拒绝了登录' : `授权失败：${error}`,
      )
    }
    const code = q.get('code')
    if (!code) throw new OpenRouterLoginError('no_code', '回调里没有授权码')

    let res: Response
    try {
      res = await this.doFetch(OPENROUTER_LOGIN.exchangeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          code,
          code_verifier: p.verifier,
          code_challenge_method: 'S256',
        }),
      })
    } catch {
      throw new OpenRouterLoginError('exchange_failed', '换取 Key 时网络出错，请重试')
    }
    if (res.status === 403) {
      throw new OpenRouterLoginError(
        'invalid_grant',
        '授权码无效或已过期（10 分钟），请重新发起登录',
      )
    }
    if (!res.ok) {
      throw new OpenRouterLoginError('exchange_failed', `换取 Key 失败：HTTP ${res.status}`)
    }
    let key: unknown
    try {
      key = ((await res.json()) as { key?: unknown }).key
    } catch {
      key = undefined
    }
    if (typeof key !== 'string' || key.length === 0) {
      throw new OpenRouterLoginError('exchange_failed', '响应里没有 key')
    }
    // 换码期间用户取消了、或登录超时了：不保存
    if (p.settled) throw new OpenRouterLoginError('cancelled', '登录已取消')
    await this.d.secrets.set(secretRef, key)
  }

  async status(providerId: string, secretRef: string | undefined): Promise<LoginStatus> {
    const key = secretRef ? await this.d.secrets.get(secretRef) : undefined
    const p = this.pending.get(providerId)
    const lastError = this.lastError.get(providerId)
    const base = { channel: 'openrouter' as const, ...(lastError ? { lastError } : {}) }
    const signedIn = key
      ? {
          credential: { kind: 'api_key' as const, mask: maskKey(key) },
          manageUrl: openRouterKeyPage(key),
        }
      : {}
    if (p) {
      return {
        ...base,
        ...signedIn,
        state: 'pending',
        pending: { expiresAt: new Date(p.expiresAt).toISOString() },
      }
    }
    return { ...base, ...signedIn, state: key ? 'signed_in' : 'signed_out' }
  }

  /** 给出换回的 Key（和 API Key 方式一样当 Bearer 用）；没登录过就是"需要登录"。 */
  async accessToken(config: ProviderConfig): Promise<string> {
    assertLoginEndpoint('openrouter', config) // 只发到 OpenRouter 官方地址
    const key = config.secretRef ? await this.d.secrets.get(config.secretRef) : undefined
    if (!key) {
      throw new LoginRequiredError('openrouter', 'not_signed_in', '还没有登录 OpenRouter 账号')
    }
    return key
  }

  /** 官方没有撤销 / 删除 Key 的接口：只清本机，`unconfirmed`，并给出 Key 管理页面让用户自己作废。 */
  async logout(providerId: string, secretRef: string | undefined) {
    this.cancel(providerId)
    const key = secretRef ? await this.d.secrets.get(secretRef) : undefined
    if (!secretRef || !key) return { revoked: 'nothing_to_revoke' as const }
    const manageUrl = openRouterKeyPage(key)
    await this.d.secrets.delete(secretRef)
    this.lastError.delete(providerId)
    this.log({ event: 'login.logout', providerId, detail: 'unconfirmed' })
    return { revoked: 'unconfirmed' as const, manageUrl }
  }

  dispose(): void {
    for (const p of [...this.pending.values()]) this.settle(p)
  }
}
