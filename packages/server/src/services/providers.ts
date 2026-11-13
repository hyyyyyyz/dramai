import type { LoginStatusDto, ProviderConfigDto } from '@dramai/api'
import {
  configFromPreset,
  effectiveAuth,
  joinUrl,
  localizeProviderConfig,
  loginEndpointProblem,
  parseResponsesModels,
  PROVIDER_PRESETS,
  ProviderError,
  sendRequest,
  testProvider,
} from '@dramai/core'
import type {
  Clock,
  CredentialResolver,
  OpenAiLogin,
  ExecutorDeps,
  IdGenerator,
  Locale,
  ModelRegistry,
  ProviderConfig,
  ProviderKind,
  SecretStore,
  TestConnectionResult,
} from '@dramai/core'
import { badRequest, conflict, HttpError, notFound } from '../errors.ts'
import { maskSecret } from '../secrets.ts'
import type { ServerStore } from '../storage/sqlite-store.ts'
import type { SettingsService } from './settings.ts'

export const secretRefFor = (providerId: string): string => `provider:${providerId}`

export interface ProviderServiceDeps {
  store: ServerStore
  secrets: SecretStore
  settings: SettingsService
  models: ModelRegistry
  ids: IdGenerator
  clock: Clock
  executor?: ExecutorDeps
  /** 账号登录（OpenAI）。 */
  login?: OpenAiLogin
  /** 统一取凭据（含登录令牌的自动刷新）。 */
  credentials?: CredentialResolver
}

/** 这次请求是不是从服务所在的机器发来的：授权回调到的是浏览器所在机器的 127.0.0.1。 */
export interface LoginRequestOrigin {
  /** 请求的 Host 头。 */
  host?: string
  /** 连接的对端地址。 */
  remoteAddress?: string
}

const LOOPBACK_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)$/i
const LOOPBACK_ADDR = /^(?:127(?:\.\d{1,3}){3}|::1|::ffff:127(?:\.\d{1,3}){3})$/

export function loginAvailability(origin: LoginRequestOrigin): LoginStatusDto['availability'] {
  const hostName = (origin.host ?? '').replace(/:\d+$/, '')
  const hostOk = hostName === '' || LOOPBACK_HOST.test(hostName)
  const addrOk = origin.remoteAddress === undefined || LOOPBACK_ADDR.test(origin.remoteAddress)
  if (hostOk && addrOk) return { available: true }
  return {
    available: false,
    reason: 'remote_access',
    message:
      '当前是从另一台机器访问 dramai：OpenAI 的授权回调只能回到浏览器所在机器的 127.0.0.1，到不了这里。' +
      '官方文档的做法是：在有浏览器的那台机器上用同一个应用完成登录，再把保存的凭据安全地传到这台机器（例如 SSH）。dramai 目前没有提供凭据导入，请在本机使用账号登录，或改用 API Key。',
  }
}

/** 服务商配置的增删改查。Key 只写进 SecretStore，对外只给掩码。 */
export class ProviderService {
  private readonly d: ProviderServiceDeps
  constructor(deps: ProviderServiceDeps) {
    this.d = deps
  }

  /**
   * 对外的视图：Key 只给掩码；账号登录只给状态（没有令牌）。由预设创建且没被改过的名称 / 备注 / 限制
   * 按 `locale` 翻译，用户改过的原样返回。
   */
  async toDto(
    cfg: ProviderConfig,
    locale: Locale = 'zh',
    origin: LoginRequestOrigin = {},
  ): Promise<ProviderConfigDto> {
    const auth = effectiveAuth(cfg)
    // 账号登录的 secretRef 指向登录记录（JSON），不是 Key：不能算"有 Key"，更不能拿去做掩码
    const key =
      auth.type === 'api_key' && cfg.secretRef ? await this.d.secrets.get(cfg.secretRef) : undefined
    const { capabilityOverrides, ...withRef } = cfg
    const rest: Omit<ProviderConfig, 'secretRef'> & { secretRef?: string } = withRef
    delete rest.secretRef
    const shown = localizeProviderConfig(cfg, locale)
    const login = auth.type === 'account_login' ? await this.loginStatus(cfg, origin) : undefined
    return {
      ...rest,
      auth,
      label: shown.label,
      ...(shown.notes === undefined ? {} : { notes: shown.notes }),
      ...(shown.knownLimitations === undefined ? {} : { knownLimitations: shown.knownLimitations }),
      ...(capabilityOverrides ? { capabilityOverrides: { ...capabilityOverrides } } : {}),
      hasKey: key !== undefined && key !== '',
      keyMask: maskSecret(key),
      ...(login ? { login } : {}),
    }
  }

  async list(): Promise<ProviderConfig[]> {
    return this.d.store.providers.list()
  }

  async require(id: string): Promise<ProviderConfig> {
    const cfg = await this.d.store.providers.get(id)
    if (!cfg) throw notFound('provider', id)
    return cfg
  }

  async create(
    input: Omit<ProviderConfig, 'id' | 'secretRef' | 'enabled'> & { enabled?: boolean },
    apiKey?: string,
  ): Promise<ProviderConfig> {
    const id = this.d.ids.next('prov')
    const auth = input.auth ?? (apiKey ? { type: 'api_key' as const } : { type: 'none' as const })
    if (auth.type === 'account_login') {
      // 令牌只发到官方的公开接口：协议和接口地址是钉死的
      const problem =
        input.kind !== 'llm'
          ? '账号登录目前只覆盖文本（大模型）服务商'
          : loginEndpointProblem(auth.channel, input)
      if (problem) throw new HttpError(400, 'AUTH_NOT_ALLOWED', problem)
      if (apiKey) throw badRequest('账号登录的服务商不需要 API Key')
    }
    const cfg: ProviderConfig = {
      ...input,
      id,
      auth,
      enabled: input.enabled ?? true,
      // 账号登录：secretRef 是登录记录的键（令牌在 SecretStore）；API Key：Key 的键
      secretRef: apiKey || auth.type === 'account_login' ? secretRefFor(id) : undefined,
    }
    if (apiKey) await this.d.secrets.set(secretRefFor(id), apiKey)
    await this.d.store.providers.put(cfg)
    await this.autoActivate(cfg)
    return cfg
  }

  async createFromPreset(presetId: string, options: { apiKey?: string; label?: string }) {
    const preset = PROVIDER_PRESETS.find((p) => p.id === presetId)
    if (!preset) throw notFound('provider_preset', presetId)
    const id = this.d.ids.next('prov')
    if (preset.auth.type === 'account_login' && options.apiKey) {
      throw badRequest('这个预设用账号登录，不需要 API Key')
    }
    const cfg = configFromPreset(preset, {
      id,
      secretRef:
        options.apiKey || preset.auth.type === 'account_login' ? secretRefFor(id) : undefined,
    })
    if (options.label) cfg.label = options.label
    if (options.apiKey) await this.d.secrets.set(secretRefFor(id), options.apiKey)
    await this.d.store.providers.put(cfg)
    await this.autoActivate(cfg)
    return cfg
  }

  /**
   * 某一类服务还没有选中的服务商时，第一个添加的自动成为当前选择（少一步设置）。
   * **按官方文档接入、未实测的预设不自动成为当前选择**——用户要自己选，才不会以为"预设 = 一定能用"。
   */
  private async autoActivate(cfg: ProviderConfig): Promise<void> {
    if (cfg.verification?.status === 'documented') return
    const settings = await this.d.settings.get()
    if (!this.d.settings.activeId(settings, cfg.kind) && cfg.enabled) {
      await this.d.settings.patchActive(cfg.kind, cfg.id)
    }
  }

  async update(id: string, patch: Partial<Omit<ProviderConfig, 'id' | 'secretRef'>>) {
    const cur = await this.require(id)
    const next: ProviderConfig = { ...cur, ...patch }
    // 登录方式的服务商：接口地址、协议、类型不能改成别的（否则令牌会发到别处）
    const auth = effectiveAuth(cur)
    if (auth.type === 'account_login') {
      const problem =
        next.kind !== 'llm'
          ? '账号登录目前只覆盖文本（大模型）服务商'
          : loginEndpointProblem(auth.channel, next)
      if (problem) throw new HttpError(400, 'AUTH_NOT_ALLOWED', problem)
    }
    await this.d.store.providers.put(next)
    return next
  }

  async delete(id: string): Promise<void> {
    const cfg = await this.require(id)
    // 账号登录：先撤销刷新令牌（尽力而为），再删凭据
    if (effectiveAuth(cfg).type === 'account_login') {
      await this.d.login?.logout(cfg.id, cfg.secretRef).catch(() => {})
    }
    if (cfg.secretRef) await this.d.secrets.delete(cfg.secretRef)
    await this.d.store.providers.delete(id)
    const settings = await this.d.settings.get()
    for (const kind of ['llm', 'image', 'video', 'tts'] as ProviderKind[]) {
      if (this.d.settings.activeId(settings, kind) === id)
        await this.d.settings.patchActive(kind, undefined)
    }
  }

  private assertNotLogin(cfg: ProviderConfig): void {
    if (effectiveAuth(cfg).type === 'account_login') {
      throw conflict('KEY_NOT_APPLICABLE', '这个服务商用账号登录，没有 API Key')
    }
  }

  async setKey(id: string, apiKey: string): Promise<ProviderConfig> {
    const cfg = await this.require(id)
    this.assertNotLogin(cfg)
    const ref = cfg.secretRef ?? secretRefFor(id)
    await this.d.secrets.set(ref, apiKey)
    // 设了 Key 就是 API Key 方式（旧数据没有 auth 字段，这里补上）
    const next = { ...cfg, secretRef: ref, auth: { type: 'api_key' as const } }
    await this.d.store.providers.put(next)
    return next
  }

  async clearKey(id: string): Promise<ProviderConfig> {
    const cfg = await this.require(id)
    this.assertNotLogin(cfg)
    if (cfg.secretRef) await this.d.secrets.delete(cfg.secretRef)
    // 清掉 Key 的服务商是「API Key 方式、Key 缺失」，不是「无需鉴权」；none 只在用户明确选择时出现
    const next = { ...cfg, secretRef: undefined, auth: { type: 'api_key' as const } }
    await this.d.store.providers.put(next)
    return next
  }

  async test(id: string): Promise<TestConnectionResult> {
    const cfg = await this.require(id)
    try {
      // 统一取凭据：登录方式下会先刷新令牌；需要重新登录时给出明确的失败信息
      const bearer = (await this.credential(cfg)).bearer
      return await testProvider(cfg, bearer, this.d.executor)
    } catch (err) {
      return { outcome: 'failed', error: err instanceof Error ? err.message : String(err) }
    }
  }

  private async credential(cfg: ProviderConfig) {
    const resolver = this.d.credentials
    if (resolver) return resolver.resolve(cfg)
    const key = cfg.secretRef ? await this.d.secrets.get(cfg.secretRef) : undefined
    return { method: effectiveAuth(cfg).type, bearer: key }
  }

  // === 账号登录 ===

  private requireLogin(cfg: ProviderConfig): OpenAiLogin {
    if (effectiveAuth(cfg).type !== 'account_login' || !this.d.login) {
      throw conflict('LOGIN_NOT_SUPPORTED', '这个服务商不是账号登录方式')
    }
    return this.d.login
  }

  async loginStatus(cfg: ProviderConfig, origin: LoginRequestOrigin = {}): Promise<LoginStatusDto> {
    const availability = loginAvailability(origin)
    if (!this.d.login) {
      return { channel: 'openai-chatgpt', state: 'signed_out', availability }
    }
    return { ...(await this.d.login.status(cfg.id, cfg.secretRef)), availability }
  }

  async loginStart(id: string, options: { account?: 'same' | 'new' }, origin: LoginRequestOrigin) {
    const cfg = await this.require(id)
    const login = this.requireLogin(cfg)
    const availability = loginAvailability(origin)
    if (!availability.available) {
      throw conflict('LOGIN_UNAVAILABLE_REMOTE', availability.message ?? '当前访问方式下不能登录')
    }
    return login.start(cfg.id, cfg.secretRef ?? secretRefFor(cfg.id), options)
  }

  async loginCancel(id: string, origin: LoginRequestOrigin = {}): Promise<LoginStatusDto> {
    const cfg = await this.require(id)
    this.requireLogin(cfg).cancel(cfg.id)
    return this.loginStatus(cfg, origin)
  }

  async logout(id: string, origin: LoginRequestOrigin = {}) {
    const cfg = await this.require(id)
    const { revoked } = await this.requireLogin(cfg).logout(cfg.id, cfg.secretRef)
    return { status: await this.loginStatus(cfg, origin), revoked }
  }

  /** 这个服务商当前能用的模型：登录方式下取 `/v1/models` 里 `visibility == "list"` 的那些。 */
  async models(id: string): Promise<Array<{ id: string; label: string }>> {
    const cfg = await this.require(id)
    if (cfg.protocol !== 'openai-responses' && cfg.protocol !== 'openai-chat') {
      throw conflict('MODEL_LIST_UNSUPPORTED', '这个服务商的协议没有模型列表')
    }
    let bearer: string | undefined
    try {
      bearer = (await this.credential(cfg)).bearer
    } catch (err) {
      if (err instanceof ProviderError && err.code === 'LOGIN_ENDPOINT_NOT_ALLOWED') {
        throw new HttpError(400, 'AUTH_NOT_ALLOWED', err.message)
      }
      throw err
    }
    const raw = await sendRequest(
      {
        method: 'GET',
        url: joinUrl(cfg.baseUrl, '/models'),
        headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
      },
      this.d.executor ?? {},
      { timeoutMs: 20_000 },
    )
    if (raw.status < 200 || raw.status >= 300) {
      throw new HttpError(502, 'PROVIDER_REQUEST_FAILED', `服务商返回 HTTP ${raw.status}`, {
        status: raw.status,
      })
    }
    return parseResponsesModels(raw.json)
  }

  capability(cfg: ProviderConfig) {
    const found = this.d.models.lookup(cfg)
    return {
      declared: found.declared,
      capability: found.capability,
      pricing: found.profile?.pricing ?? [],
      quirks: found.profile?.quirks ?? [],
      provenance: found.profile?.provenance,
    }
  }
}
