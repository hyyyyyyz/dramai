import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { SecretStore } from '../../ports/index.ts'
import { assertLoginEndpoint, LoginRequiredError } from '../auth.ts'
import { ProviderError } from '../errors.ts'
import type { ProviderConfig } from '../types.ts'
import { parseJwt, verifyJwtSignature } from './jwt.ts'
import type {
  ListenerFactory,
  LoginErrorCode,
  LoginService,
  LoginStatus,
  LoopbackListener,
} from './types.ts'
import type { Jwk } from './jwt.ts'

/**
 * OpenAI 账号登录（"Sign in with ChatGPT" 的 ChatGPT 用量，面向开源 / 本地运行的应用）。
 *
 * 依据只有官方文档（https://developers.openai.com/siwc/token-sharing-open-source 及其子页，
 * 以及 https://auth.openai.com/.well-known/openid-configuration），没有借用任何别家客户端的身份，
 * 也不调 ChatGPT 的后台接口——推理只走公开的 https://api.openai.com/v1/responses。
 *
 * 流程：动态注册（第一次授权用 `client_id=dynamic_agent_client`，回调带回签发的 client_id，保存复用）→
 * PKCE(S256) + 每次新的 state / nonce → 回调到 127.0.0.1 的回环地址 → 校验 state → 换令牌 →
 * 校验 ID token（JWKS 验签、签发方、受众、到期、nonce）→ 确认授予的范围里有 `chatgpt.tokens.use.direct`
 * → 凭据按"已签发的 client_id + 已验证账号"保存。重新授权必须是同一个账号。
 *
 * 凭据只存在 SecretStore（JSON 字符串）；对外的状态只有登录与否、账号的显示标识、到期时间。
 * 令牌不进日志、不进响应、不进 URL；授权地址里不带 `id_token_hint`（用 `login_hint`），
 * 所以连 ID token 都不会出现在返回给界面的地址里。
 */

export const OPENAI_LOGIN = {
  issuer: 'https://auth.openai.com',
  authorizeUrl: 'https://auth.openai.com/api/accounts/authorize',
  tokenUrl: 'https://auth.openai.com/api/accounts/oauth/token',
  discoveryUrl: 'https://auth.openai.com/.well-known/openid-configuration',
  jwksUrl: 'https://auth.openai.com/.well-known/jwks.json',
  revokeUrl: 'https://auth.openai.com/api/accounts/oauth/revoke',
  resource: 'https://api.openai.com/v1',
  dynamicClientId: 'dynamic_agent_client',
  scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
  planScope: 'chatgpt.tokens.use.direct',
  callbackPath: '/auth/callback',
  /** 文档示例用的端口；被占用时换一个（文档：后续登录只有端口可以变）。 */
  preferredPort: 1455,
} as const

export type OpenAiLoginErrorCode = LoginErrorCode

export class OpenAiLoginError extends Error {
  readonly code: OpenAiLoginErrorCode
  constructor(code: OpenAiLoginErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'OpenAiLoginError'
    this.code = code
  }
}

/** 保存在 SecretStore 里的一条登录记录（每个服务商配置一条）。 */
export interface LoginRecord {
  v: 1
  channel: 'openai-chatgpt'
  /** 签发的 client_id（oaiapp_…）。登出后保留，之后的登录复用。 */
  clientId: string
  hostId: string
  issuer: string
  subject: string
  email?: string
  accessToken?: string
  refreshToken?: string
  tokenType?: string
  /** 访问令牌到期时间（毫秒时间戳）。 */
  expiresAt?: number
  scopes?: string[]
  /** 授予的范围里有 chatgpt.tokens.use.direct。没有就不能调用。 */
  planUsage: boolean
  /** 刷新令牌已被确认不可用：需要重新登录（保留 clientId 和账号，用来重新授权）。 */
  needsRelogin?: boolean
  earliestRefreshAt?: number
  savedAt: string
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface OpenAiLoginDeps {
  secrets: SecretStore
  listen: ListenerFactory
  fetch?: FetchLike
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** 只收到不含凭据的事件（用于日志）。 */
  log?: (event: { event: string; providerId?: string; code?: string; detail?: string }) => void
  /** 应用名，注册时作为 `agent_name_hint`（以后保持一致）。 */
  appName?: string
  /** 授权等待多久超时（毫秒），默认 10 分钟。 */
  loginTimeoutMs?: number
  /** 访问令牌距离到期多久开始刷新（毫秒），默认 2 分钟。 */
  refreshMarginMs?: number
}

interface PendingLogin {
  providerId: string
  state: string
  nonce: string
  verifier: string
  redirectUri: string
  clientId: string
  registration: boolean
  existing?: LoginRecord
  listener: LoopbackListener
  timer: ReturnType<typeof setTimeout>
  expiresAt: number
  settled: boolean
}

/** 记录去掉令牌和到期时间（保留注册和账号标识）。 */
function withoutTokens(rec: LoginRecord): LoginRecord {
  const copy = { ...rec }
  delete copy.accessToken
  delete copy.refreshToken
  delete copy.expiresAt
  return copy
}

const b64url = (buf: Buffer) => buf.toString('base64url')
export const pkceChallenge = (verifier: string): string =>
  b64url(createHash('sha256').update(verifier).digest())

const HOST_ID_KEY = 'login:openai-chatgpt:host-id'
const TERMINAL_REFRESH_ERRORS = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
])

export class OpenAiLogin implements LoginService {
  readonly id = 'openai-chatgpt' as const
  private readonly d: Required<Pick<OpenAiLoginDeps, 'secrets' | 'listen'>> & OpenAiLoginDeps
  private readonly pending = new Map<string, PendingLogin>()
  private readonly lastError = new Map<string, NonNullable<LoginStatus['lastError']>>()
  private readonly refreshing = new Map<string, Promise<string>>()
  private jwks: { keys: Jwk[]; at: number } | undefined
  private disco: { value: { jwksUrl: string; revokeUrl: string }; at: number } | undefined

  constructor(deps: OpenAiLoginDeps) {
    this.d = deps
  }

  private now = () => (this.d.now ?? Date.now)()
  private doFetch: FetchLike = (url, init) => (this.d.fetch ?? fetch)(url, init)
  private log = (e: Parameters<NonNullable<OpenAiLoginDeps['log']>>[0]) => this.d.log?.(e)

  // === 记录 ===

  private async load(ref: string): Promise<LoginRecord | undefined> {
    const raw = await this.d.secrets.get(ref)
    if (!raw) return undefined
    try {
      const rec = JSON.parse(raw) as LoginRecord
      return rec && rec.channel === 'openai-chatgpt' ? rec : undefined
    } catch {
      return undefined
    }
  }

  private async save(ref: string, rec: LoginRecord): Promise<void> {
    await this.d.secrets.set(ref, JSON.stringify(rec))
  }

  /** 每台主机一个稳定的不透明 ID（`urn:uuid:`，文档允许的格式之一），第一次登录前生成并保存。 */
  private async hostId(): Promise<string> {
    const cur = await this.d.secrets.get(HOST_ID_KEY)
    if (cur) return cur
    const id = `urn:uuid:${randomUUID()}`
    await this.d.secrets.set(HOST_ID_KEY, id)
    return id
  }

  // === 发起 / 状态 / 取消 ===

  /**
   * 发起登录。返回要在浏览器里打开的地址；回调由临时监听器接收。
   * - 这个服务商已经注册过：默认重新授权（复用 client_id，`login_hint` 带上邮箱，结果必须是同一个账号）。
   * - `account: 'new'`：换一个账号，重新注册；成功后才替换旧记录。
   */
  async start(
    providerId: string,
    secretRef: string,
    options: { account?: 'same' | 'new' } = {},
  ): Promise<{ authorizationUrl: string; redirectUri: string; expiresAt: string }> {
    this.cancel(providerId, 'cancelled')
    const existing = await this.load(secretRef)
    const reauthorize = existing !== undefined && options.account !== 'new'
    const hostId = existing?.hostId ?? (await this.hostId())

    const state = b64url(randomBytes(24))
    const nonce = b64url(randomBytes(24))
    const verifier = b64url(randomBytes(32))
    const clientId = reauthorize ? existing.clientId : OPENAI_LOGIN.dynamicClientId

    // 先起监听器，再给出地址（文档：先监听，再打开浏览器）
    const listener = await this.d.listen((params) => this.onCallback(providerId, secretRef, params))
    const timeoutMs = this.d.loginTimeoutMs ?? 10 * 60_000
    const p: PendingLogin = {
      providerId,
      state,
      nonce,
      verifier,
      redirectUri: listener.redirectUri,
      clientId,
      registration: !reauthorize,
      existing,
      listener,
      expiresAt: this.now() + timeoutMs,
      settled: false,
      timer: setTimeout(
        () => this.fail(p, new OpenAiLoginError('timeout', '登录超时，请重新发起')),
        timeoutMs,
      ),
    }
    p.timer.unref?.()
    this.pending.set(providerId, p)
    this.lastError.delete(providerId)

    const q = new URLSearchParams()
    q.set('client_id', clientId)
    q.set('response_type', 'code')
    q.set('redirect_uri', listener.redirectUri)
    q.set('scope', OPENAI_LOGIN.scope)
    q.set('resource', OPENAI_LOGIN.resource)
    q.set('state', state)
    q.set('nonce', nonce)
    q.set('code_challenge', pkceChallenge(verifier))
    q.set('code_challenge_method', 'S256')
    q.set('ext_agent_host_id', hostId)
    if (!reauthorize) q.set('agent_name_hint', this.d.appName ?? 'dramai')
    else if (existing.email) q.set('login_hint', existing.email)
    this.log({ event: 'login.start', providerId, detail: reauthorize ? 'reauthorize' : 'register' })
    return {
      authorizationUrl: `${OPENAI_LOGIN.authorizeUrl}?${q.toString()}`,
      redirectUri: listener.redirectUri,
      expiresAt: new Date(p.expiresAt).toISOString(),
    }
  }

  cancel(providerId: string, code: 'cancelled' = 'cancelled'): boolean {
    const p = this.pending.get(providerId)
    if (!p) return false
    this.settle(p)
    this.log({ event: 'login.cancel', providerId, code })
    return true
  }

  private settle(p: PendingLogin): void {
    p.settled = true
    clearTimeout(p.timer)
    try {
      p.listener.close()
    } catch {
      /* already closed */
    }
    if (this.pending.get(p.providerId) === p) this.pending.delete(p.providerId)
  }

  private fail(p: PendingLogin, err: OpenAiLoginError): void {
    // 只结束"这一次"登录：用户可能已经发起了新的一次
    if (p.settled) return
    this.settle(p)
    const providerId = p.providerId
    this.lastError.set(providerId, {
      code: err.code,
      message: err.message,
      at: new Date(this.now()).toISOString(),
    })
    this.log({ event: 'login.failed', providerId, code: err.code })
  }

  async status(providerId: string, secretRef: string | undefined): Promise<LoginStatus> {
    const rec = secretRef ? await this.load(secretRef) : undefined
    const p = this.pending.get(providerId)
    const lastError = this.lastError.get(providerId)
    const base = { channel: 'openai-chatgpt' as const, ...(lastError ? { lastError } : {}) }
    const account = rec ? { account: { label: rec.email ?? 'ChatGPT' } } : {}
    if (p) {
      return {
        ...base,
        ...account,
        state: 'pending',
        pending: { expiresAt: new Date(p.expiresAt).toISOString() },
      }
    }
    if (!rec) return { ...base, state: 'signed_out' }
    if (!rec.accessToken || !rec.refreshToken) {
      return { ...base, ...account, state: rec.needsRelogin ? 'needs_relogin' : 'signed_out' }
    }
    return {
      ...base,
      ...account,
      state: 'signed_in',
      planUsage: rec.planUsage,
      ...(rec.expiresAt ? { expiresAt: new Date(rec.expiresAt).toISOString() } : {}),
    }
  }

  // === 回调 ===

  private async onCallback(
    providerId: string,
    secretRef: string,
    params: URLSearchParams,
  ): Promise<{ ok: boolean; error?: OpenAiLoginErrorCode }> {
    const p = this.pending.get(providerId)
    if (!p || p.settled) return { ok: false, error: 'cancelled' }
    // state 不符的请求不是这次登录的回调（登录期间浏览器里任何网页都能向回环地址发 GET）：
    // 只拒绝这一个请求，不结束登录，继续等真正的回调或超时。
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
      // 换令牌的请求还在途中时登录被取消 / 超时了：这次登录已经结束，不记为失败
      if (p.settled) return { ok: false, error: 'cancelled' }
      const e =
        err instanceof OpenAiLoginError
          ? err
          : new OpenAiLoginError('exchange_failed', '登录没有完成，请重试', { cause: err })
      this.fail(p, e)
      return { ok: false, error: e.code }
    }
  }

  private async complete(p: PendingLogin, secretRef: string, q: URLSearchParams): Promise<void> {
    // 1. state 先于一切：不符就不看任何结果
    if (q.get('state') !== p.state) {
      throw new OpenAiLoginError('state_mismatch', '回调的 state 不符，已拒绝')
    }
    // 2. 用户拒绝或授权出错：不换令牌
    const error = q.get('error')
    if (error) {
      throw new OpenAiLoginError(
        error === 'access_denied' ? 'user_denied' : 'authorization_error',
        error === 'access_denied' ? '你在授权页拒绝了登录' : `授权失败：${error}`,
      )
    }
    const code = q.get('code')
    if (!code) throw new OpenAiLoginError('no_code', '回调里没有授权码')

    // 3. 签发的 client_id
    const returnedClient = q.get('client_id')
    let clientId = p.clientId
    if (p.registration) {
      if (!returnedClient || returnedClient === OPENAI_LOGIN.dynamicClientId) {
        throw new OpenAiLoginError(
          'registration_incomplete',
          '回调里没有签发的 client_id，注册没有完成',
        )
      }
      clientId = returnedClient
    } else if (returnedClient && returnedClient !== p.clientId) {
      throw new OpenAiLoginError('client_mismatch', '回调带回了另一个 client_id，已拒绝')
    }

    // 4. 换令牌（表单，无客户端密钥）
    const tok = await this.tokenRequest(
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: p.verifier,
        redirect_uri: p.redirectUri,
        resource: OPENAI_LOGIN.resource,
      }),
    )
    if (!tok.ok) {
      throw new OpenAiLoginError(
        tok.error === 'invalid_grant' ? 'invalid_grant' : 'exchange_failed',
        tok.error === 'invalid_grant'
          ? '授权码已失效，请重新发起登录'
          : `换取令牌失败：${tok.error ?? tok.status}`,
      )
    }
    const t = tok.body
    if (typeof t.access_token !== 'string' || typeof t.id_token !== 'string') {
      throw new OpenAiLoginError('exchange_failed', '令牌响应缺少 access_token 或 id_token')
    }

    // 5. ID token：验签、签发方、受众、到期、nonce
    const id = await this.verifyIdToken(t.id_token, { clientId, nonce: p.nonce })

    // 6. 重新授权必须是同一个账号：确认后才替换凭据
    if (p.existing && !p.registration) {
      if (p.existing.subject !== id.sub || p.existing.issuer !== id.iss) {
        throw new OpenAiLoginError('account_mismatch', '登录的账号和之前保存的不是同一个，已拒绝')
      }
    }

    // 7. 范围：必须有允许使用 ChatGPT 用量的那一项
    const scopes = typeof t.scope === 'string' ? t.scope.split(/\s+/).filter(Boolean) : []
    const planUsage = scopes.includes(OPENAI_LOGIN.planScope)

    // 换令牌期间用户取消了、或登录超时了：不保存任何凭据
    if (p.settled) throw new OpenAiLoginError('cancelled', '登录已取消')

    const hostId = p.existing?.hostId ?? (await this.hostId())
    const rec: LoginRecord = {
      v: 1,
      channel: 'openai-chatgpt',
      clientId,
      hostId,
      issuer: id.iss,
      subject: id.sub,
      email: id.email,
      accessToken: t.access_token,
      refreshToken: typeof t.refresh_token === 'string' ? t.refresh_token : undefined,
      tokenType: typeof t.token_type === 'string' ? t.token_type : 'Bearer',
      expiresAt: this.now() + (typeof t.expires_in === 'number' ? t.expires_in : 3600) * 1000,
      scopes,
      planUsage,
      earliestRefreshAt:
        typeof t.earliest_refresh_at === 'number' ? t.earliest_refresh_at : undefined,
      savedAt: new Date(this.now()).toISOString(),
    }
    // 换了账号（重新注册）：先尽力撤销旧的刷新令牌，再替换
    if (p.settled) throw new OpenAiLoginError('cancelled', '登录已取消')
    if (p.existing && p.registration && p.existing.refreshToken) {
      await this.revoke(p.existing).catch(() => {})
    }
    if (p.settled) throw new OpenAiLoginError('cancelled', '登录已取消')
    await this.save(secretRef, rec)
  }

  // === ID token ===

  /**
   * 发现文档（缓存 1 小时）：JWKS 地址和撤销端点从这里取，签发方必须和已知的一致、地址必须是同一来源下的 https。
   * 取不到或不合规就用文档里写明的固定地址回退。
   */
  private async discovery(): Promise<{ jwksUrl: string; revokeUrl: string }> {
    if (this.disco && this.now() - this.disco.at < 60 * 60_000) return this.disco.value
    const value: { jwksUrl: string; revokeUrl: string } = {
      jwksUrl: OPENAI_LOGIN.jwksUrl,
      revokeUrl: OPENAI_LOGIN.revokeUrl,
    }
    try {
      const res = await this.doFetch(OPENAI_LOGIN.discoveryUrl)
      if (res.ok) {
        const doc = (await res.json()) as {
          issuer?: string
          jwks_uri?: string
          revocation_endpoint?: string
        }
        const trusted = (url: string | undefined): string | undefined => {
          if (!url || doc.issuer !== OPENAI_LOGIN.issuer) return undefined
          try {
            const u = new URL(url)
            return u.protocol === 'https:' && u.origin === OPENAI_LOGIN.issuer ? url : undefined
          } catch {
            return undefined
          }
        }
        value.jwksUrl = trusted(doc.jwks_uri) ?? value.jwksUrl
        value.revokeUrl = trusted(doc.revocation_endpoint) ?? value.revokeUrl
      }
    } catch {
      /* fall back to the documented addresses */
    }
    this.disco = { value, at: this.now() }
    return value
  }

  private async keys(refetch = false): Promise<Jwk[]> {
    if (!refetch && this.jwks && this.now() - this.jwks.at < 60 * 60_000) return this.jwks.keys
    const res = await this.doFetch((await this.discovery()).jwksUrl)
    if (!res.ok) throw new OpenAiLoginError('bad_signature', '取不到 OpenAI 的签名公钥（JWKS）')
    const body = (await res.json()) as { keys?: Jwk[] }
    this.jwks = { keys: body.keys ?? [], at: this.now() }
    return this.jwks.keys
  }

  async verifyIdToken(
    token: string,
    expected: { clientId: string; nonce: string },
  ): Promise<{ iss: string; sub: string; email?: string }> {
    let parsed
    try {
      parsed = parseJwt(token)
    } catch (err) {
      throw new OpenAiLoginError('bad_id_token', 'ID token 格式不对', { cause: err })
    }
    try {
      try {
        verifyJwtSignature(parsed, await this.keys())
      } catch (err) {
        // 密钥轮换：公钥列表里没有这个 kid 时重新取一次
        if ((err as { code?: string }).code !== 'unknown_key') throw err
        verifyJwtSignature(parsed, await this.keys(true))
      }
    } catch (err) {
      if (err instanceof OpenAiLoginError) throw err
      throw new OpenAiLoginError('bad_signature', 'ID token 签名校验失败', { cause: err })
    }
    const c = parsed.claims
    if (c.iss !== OPENAI_LOGIN.issuer) {
      throw new OpenAiLoginError('issuer_mismatch', 'ID token 的签发方不对')
    }
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud]
    if (!aud.includes(expected.clientId)) {
      throw new OpenAiLoginError('audience_mismatch', 'ID token 的受众不是这个 client_id')
    }
    const nowSec = this.now() / 1000
    if (typeof c.exp !== 'number' || c.exp <= nowSec - 30) {
      throw new OpenAiLoginError('expired', 'ID token 已过期')
    }
    if (typeof c.nbf === 'number' && c.nbf > nowSec + 30) {
      throw new OpenAiLoginError('expired', 'ID token 还没生效')
    }
    if (c.nonce !== expected.nonce) {
      throw new OpenAiLoginError('nonce_mismatch', 'ID token 的 nonce 不符，已拒绝')
    }
    if (typeof c.sub !== 'string' || !c.sub) {
      throw new OpenAiLoginError('bad_id_token', 'ID token 缺少 sub')
    }
    return {
      iss: c.iss as string,
      sub: c.sub,
      email: typeof c.email === 'string' ? c.email : undefined,
    }
  }

  // === 令牌端点 ===

  private async tokenRequest(
    form: URLSearchParams,
  ): Promise<
    | { ok: true; body: Record<string, unknown> }
    | { ok: false; status: number; error?: string; transient: boolean }
  > {
    let res: Response
    try {
      res = await this.doFetch(OPENAI_LOGIN.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: form.toString(),
      })
    } catch {
      return { ok: false, status: 0, error: 'network', transient: true }
    }
    let body: Record<string, unknown> = {}
    try {
      body = (await res.json()) as Record<string, unknown>
    } catch {
      /* not json */
    }
    if (res.ok) return { ok: true, body }
    return {
      ok: false,
      status: res.status,
      error: typeof body.error === 'string' ? body.error : undefined,
      transient: res.status >= 500 || res.status === 429,
    }
  }

  // === 刷新（LoginChannel） ===

  /**
   * 给出当前有效的访问令牌；临近过期（默认 2 分钟内）或已过期时先刷新。
   * 同一个账号并发调用只发一次刷新。刷新令牌确认不可用 → `LoginRequiredError('refresh_failed')`，
   * 并标记需要重新登录；网络错误 / 5xx 只是普通错误，凭据保留（文档：临时故障不要删凭据）。
   */
  async accessToken(config: ProviderConfig): Promise<string> {
    // 令牌只发到官方的公开接口：这里再核对一次，保护已经存下来的配置
    assertLoginEndpoint('openai-chatgpt', config)
    const ref = config.secretRef
    const rec = ref ? await this.load(ref) : undefined
    if (!ref || !rec || !rec.accessToken || !rec.refreshToken) {
      throw new LoginRequiredError(
        'openai-chatgpt',
        rec?.needsRelogin ? 'refresh_failed' : 'not_signed_in',
        rec?.needsRelogin ? '登录已失效，需要重新登录 OpenAI 账号' : '还没有登录 OpenAI 账号',
      )
    }
    if (!rec.planUsage) {
      throw new LoginRequiredError(
        'openai-chatgpt',
        'plan_usage_not_granted',
        '这次登录没有授予使用 ChatGPT 用量的范围，不能调用。请重新登录并同意该授权',
      )
    }
    const margin = this.d.refreshMarginMs ?? 120_000
    if (rec.expiresAt !== undefined && rec.expiresAt - this.now() > margin) return rec.accessToken
    const inflight = this.refreshing.get(ref)
    if (inflight) return inflight
    const run = this.refresh(ref, config.id).finally(() => this.refreshing.delete(ref))
    this.refreshing.set(ref, run)
    return run
  }

  private async refresh(ref: string, providerId: string): Promise<string> {
    const rec = await this.load(ref)
    if (!rec?.refreshToken) {
      throw new LoginRequiredError('openai-chatgpt', 'not_signed_in', '还没有登录 OpenAI 账号')
    }
    // 不带 scope：保持原有授权
    const r = await this.tokenRequest(
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: rec.clientId,
        refresh_token: rec.refreshToken,
        resource: OPENAI_LOGIN.resource,
      }),
    )
    if (!r.ok) {
      if (r.transient) {
        throw new ProviderError(
          'network',
          '刷新 OpenAI 登录令牌失败（网络或服务暂时不可用），稍后重试',
          {
            status: r.status || undefined,
            code: 'LOGIN_REFRESH_UNAVAILABLE',
          },
        )
      }
      // 官方 errors-and-recovery 页：invalid_client 是客户端配置问题；不在"刷新令牌不可用"列表里的拒绝没有写处理办法。
      // 这两种都不清凭据（也许只是暂时的），但如实提示"可以尝试重新登录"，并让登录状态带上这条提示。
      const rejected = (code: string, message: string): ProviderError => {
        this.lastError.set(providerId, {
          code: 'refresh_rejected',
          message,
          at: new Date(this.now()).toISOString(),
        })
        this.log({
          event: 'login.refresh_rejected',
          providerId,
          code: r.error ?? `http_${r.status}`,
        })
        return new ProviderError('http', message, { status: r.status, code })
      }
      if (r.error === 'invalid_client') {
        throw rejected(
          'LOGIN_INVALID_CLIENT',
          'OpenAI 登录的客户端配置被拒绝（invalid_client），可以尝试重新登录',
        )
      }
      if (r.error && TERMINAL_REFRESH_ERRORS.has(r.error)) {
        // 刷新令牌不可用：清掉令牌，保留注册和账号用于重新授权
        const keep = withoutTokens(rec)
        await this.save(ref, {
          ...keep,
          needsRelogin: true,
          savedAt: new Date(this.now()).toISOString(),
        })
        this.log({ event: 'login.refresh_failed', code: r.error })
        throw new LoginRequiredError(
          'openai-chatgpt',
          'refresh_failed',
          '登录已失效，需要重新登录 OpenAI 账号',
        )
      }
      throw rejected(
        'LOGIN_REFRESH_REJECTED',
        `刷新登录令牌被拒绝（${r.error ?? `HTTP ${r.status}`}），可以尝试重新登录`,
      )
    }
    const t = r.body
    if (typeof t.access_token !== 'string') {
      throw new ProviderError('parse', '刷新响应缺少 access_token', {
        code: 'LOGIN_REFRESH_BAD_RESPONSE',
      })
    }
    const scopes =
      typeof t.scope === 'string' ? t.scope.split(/\s+/).filter(Boolean) : (rec.scopes ?? [])
    // 访问令牌、到期时间、范围和轮换后的刷新令牌一起替换
    const next: LoginRecord = {
      ...rec,
      accessToken: t.access_token,
      refreshToken: typeof t.refresh_token === 'string' ? t.refresh_token : rec.refreshToken,
      tokenType: typeof t.token_type === 'string' ? t.token_type : rec.tokenType,
      expiresAt: this.now() + (typeof t.expires_in === 'number' ? t.expires_in : 3600) * 1000,
      scopes,
      planUsage: scopes.includes(OPENAI_LOGIN.planScope),
      needsRelogin: undefined,
      earliestRefreshAt:
        typeof t.earliest_refresh_at === 'number' ? t.earliest_refresh_at : rec.earliestRefreshAt,
      savedAt: new Date(this.now()).toISOString(),
    }
    await this.save(ref, next)
    this.lastError.delete(providerId)
    return next.accessToken!
  }

  // === 登出 ===

  /**
   * 停止这个服务商的登录、撤销刷新令牌（尽力而为，网络错误 / 5xx 退避重试）、清掉本地令牌；
   * 保留注册（client_id、主机 ID、账号标识）供以后重新登录。撤销没有得到确认时如实告诉调用方。
   */
  async logout(
    providerId: string,
    secretRef: string | undefined,
  ): Promise<{ revoked: 'confirmed' | 'unconfirmed' | 'nothing_to_revoke' }> {
    this.cancel(providerId)
    const rec = secretRef ? await this.load(secretRef) : undefined
    if (!secretRef || !rec) return { revoked: 'nothing_to_revoke' }
    let revoked: 'confirmed' | 'unconfirmed' | 'nothing_to_revoke' = 'nothing_to_revoke'
    if (rec.refreshToken) {
      revoked = (await this.revoke(rec).catch(() => false)) ? 'confirmed' : 'unconfirmed'
    }
    const keep = withoutTokens(rec)
    await this.save(secretRef, {
      ...keep,
      needsRelogin: undefined,
      savedAt: new Date(this.now()).toISOString(),
    })
    this.lastError.delete(providerId)
    this.log({ event: 'login.logout', providerId, detail: revoked })
    return { revoked }
  }

  /** POST 到撤销端点；返回 true = 收到 200（包括令牌本来就无效）。 */
  private async revoke(rec: LoginRecord): Promise<boolean> {
    const url = (await this.discovery()).revokeUrl
    const sleep = this.d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await this.doFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: rec.refreshToken!,
            token_type_hint: 'refresh_token',
            client_id: rec.clientId,
          }).toString(),
        })
        if (res.status === 200) return true
        if (res.status < 500) return false
      } catch {
        /* network: retry */
      }
      if (attempt < 2) await sleep(500 * 2 ** attempt)
    }
    return false
  }

  /** 供测试和关闭服务时用：关掉所有进行中的登录。 */
  dispose(): void {
    for (const p of [...this.pending.values()]) this.settle(p)
  }
}
