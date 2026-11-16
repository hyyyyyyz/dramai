import type {
  LoginStatusDto,
  ProviderConfigDto,
  ProviderProbeInput,
  ProviderProbeResult,
} from '@dramai/api'
import {
  checkBaseUrl,
  configFromPreset,
  effectiveAuth,
  localizeProviderConfig,
  loginEndpointProblem,
  modelListRequest,
  PROVIDER_PRESETS,
  ProviderError,
  RESULT_TEXT_FIELDS,
  redactFields,
  redactText,
  redactProviderError,
  sendRequest,
  speechDefaultVoiceOf,
  speechInputSupportOf,
  testProvider,
  upstreamErrorCode,
} from '@dramai/core'
import type {
  Clock,
  CredentialResolver,
  LoginChannelId,
  LoginService,
  ExecutorDeps,
  IdGenerator,
  Locale,
  ModelRegistry,
  ProtocolId,
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

/** `providers.probe` 的入参（见 `@dramai/api` 的 `providerProbe`）。 */
export type ProbeInput = ProviderProbeInput

export interface ProviderServiceDeps {
  store: ServerStore
  secrets: SecretStore
  settings: SettingsService
  models: ModelRegistry
  ids: IdGenerator
  clock: Clock
  executor?: ExecutorDeps
  /** 账号登录（OpenAI）。 */
  logins?: Partial<Record<LoginChannelId, LoginService>>
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

  /**
   * 写入前校验接口地址（创建、按预设创建、改地址三处共用同一套规则，见 core 的 `checkBaseUrl`）。
   * 只在写入时做：库里已有的旧配置不会因为规则收紧而读不出来。返回去掉首尾空白的地址。
   */
  private checkedBaseUrl(url: string): string {
    const checked = checkBaseUrl(url)
    if (checked.ok) return checked.url
    throw new HttpError(
      400,
      checked.code,
      checked.message,
      checked.code === 'BASE_URL_PLACEHOLDER_UNFILLED'
        ? { placeholders: checked.placeholders }
        : undefined,
    )
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
    const baseUrl = this.checkedBaseUrl(input.baseUrl)
    const cfg: ProviderConfig = {
      ...input,
      baseUrl,
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

  async createFromPreset(
    presetId: string,
    options: { apiKey?: string; label?: string; baseUrl?: string; model?: string },
  ) {
    const preset = PROVIDER_PRESETS.find((p) => p.id === presetId)
    if (!preset) throw notFound('provider_preset', presetId)
    if (preset.auth.type === 'account_login' && options.apiKey) {
      throw badRequest('这个预设用账号登录，不需要 API Key')
    }
    // 接口地址：账号登录的预设钉死不能改；其余的覆盖值或预设原值都要过基本校验
    // （尤其是预设里还带 {占位符} 却没填的——建出来也只会 404，拒绝比留一份坏配置好）。
    const override = options.baseUrl?.trim()
    if (override && preset.auth.type === 'account_login') {
      throw new HttpError(
        400,
        'BASE_URL_NOT_OVERRIDABLE',
        '账号登录的预设接口地址是固定的，不能覆盖',
      )
    }
    const baseUrl = override || preset.baseUrl
    const checked = { url: this.checkedBaseUrl(baseUrl) }
    const id = this.d.ids.next('prov')
    const cfg = configFromPreset(preset, {
      id,
      secretRef:
        options.apiKey || preset.auth.type === 'account_login' ? secretRefFor(id) : undefined,
    })
    if (options.label) cfg.label = options.label
    cfg.baseUrl = checked.url
    if (options.model?.trim()) cfg.model = options.model.trim()
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
    // 只有这次真的改了地址才校验：没动地址的更新不会因为旧地址不符合新规则而失败
    if (patch.baseUrl !== undefined && patch.baseUrl !== cur.baseUrl) {
      next.baseUrl = this.checkedBaseUrl(patch.baseUrl)
    }
    await this.d.store.providers.put(next)
    return next
  }

  async delete(id: string): Promise<void> {
    const cfg = await this.require(id)
    // 账号登录：先登出（有撤销接口的通道会撤销令牌，尽力而为），再删凭据
    const auth = effectiveAuth(cfg)
    if (auth.type === 'account_login') {
      await this.d.logins?.[auth.channel]?.logout(cfg.id, cfg.secretRef).catch(() => {})
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

  /**
   * 对一份**没保存**的草稿取模型列表或测试连接。不创建、不修改任何东西；草稿的 Key 只在这一次请求里用，
   * 不写 SecretStore，也不会出现在返回值里（上游把 Key 回显在错误体里时，这里替换成 `[redacted]`）。
   *
   * 顺序与 `create` 一致：先核对账号登录的限制，再用同一个 `checkedBaseUrl` 校验地址——两者都在发任何请求之前，
   * 被拒绝的地址用同一个错误码。请求本身复用 `testProvider` / `modelListRequest` / `sendRequest`（超时、重定向、
   * 受保护请求头的处理都是它们现有的）。
   */
  async probe(input: ProbeInput): Promise<ProviderProbeResult> {
    const { auth } = input
    if (auth.type === 'account_login') {
      const problem =
        input.kind !== 'llm'
          ? '账号登录目前只覆盖文本（大模型）服务商'
          : loginEndpointProblem(auth.channel, input)
      if (problem) throw new HttpError(400, 'AUTH_NOT_ALLOWED', problem)
    }
    const baseUrl = this.checkedBaseUrl(input.baseUrl)
    if (auth.type === 'account_login') {
      // 令牌挂在已保存的服务商上：登录只能在添加之后进行，这里不发任何请求
      return {
        outcome: 'login_after_save',
        channel: auth.channel,
        message:
          '账号登录要先添加这个服务商，再在服务商卡片上登录；添加之前不能测试连接或获取模型列表',
      }
    }
    const secret = auth.type === 'api_key' ? auth.apiKey : undefined
    const extraHeaders = input.dialect?.extraHeaders
    const result =
      input.action === 'models'
        ? await this.probeModels(input.protocol, baseUrl, secret, extraHeaders)
        : await this.probeTest(input, baseUrl, secret)
    return redactFields(result, [secret], RESULT_TEXT_FIELDS)
  }

  private async probeTest(
    input: ProbeInput,
    baseUrl: string,
    secret: string | undefined,
  ): Promise<ProviderProbeResult> {
    try {
      const res = await testProvider(
        {
          baseUrl,
          protocol: input.protocol,
          model: input.model ?? '',
          ...(input.dialect?.extraHeaders
            ? { dialect: { extraHeaders: input.dialect.extraHeaders } }
            : {}),
        },
        secret,
        this.d.executor,
      )
      // 没填型号就没有"型号在不在列表里"可说
      if (res.outcome === 'ok' && !input.model) delete res.modelListed
      return res
    } catch (err) {
      return {
        outcome: 'failed',
        error: err instanceof Error ? err.message : String(err),
        ...(err instanceof ProviderError ? { code: err.code } : {}),
      }
    }
  }

  private async probeModels(
    protocol: ProbeInput['protocol'],
    baseUrl: string,
    secret: string | undefined,
    extraHeaders: Record<string, string> | undefined,
  ): Promise<ProviderProbeResult> {
    try {
      const listed = await this.listModels(protocol, baseUrl, secret, extraHeaders)
      if (listed.kind === 'unsupported') {
        return { outcome: 'no_model_list', message: '这个接口类型没有模型列表接口' }
      }
      if (listed.kind === 'http') {
        return { outcome: 'failed', status: listed.status, code: listed.code, error: listed.error }
      }
      return { outcome: 'models', items: listed.items }
    } catch (err) {
      return {
        outcome: 'failed',
        error: err instanceof Error ? err.message : String(err),
        ...(err instanceof ProviderError ? { code: err.code } : {}),
      }
    }
  }

  /**
   * 取模型列表的唯一实现：`providers.models`（已保存的服务商）和 `providers.probe`（草稿）都走这里，
   * 发的请求、判定、失败时给出的上游信息（状态码、稳定码、响应体前 180 个字符）完全一致，且都已去掉凭据。
   * 网络类错误（连不上、超时）抛 `ProviderError`（已去掉凭据）。
   */
  private async listModels(
    protocol: ProtocolId,
    baseUrl: string,
    bearer: string | undefined,
    extraHeaders: Record<string, string> | undefined,
  ): Promise<
    | { kind: 'unsupported' }
    | { kind: 'ok'; items: Array<{ id: string; label: string }> }
    | { kind: 'http'; status: number; code: string; error: string }
  > {
    const req = modelListRequest(protocol, baseUrl, bearer, extraHeaders)
    if (!req) return { kind: 'unsupported' }
    let raw
    try {
      raw = await sendRequest(
        { method: 'GET', url: req.url, headers: req.headers },
        this.d.executor ?? {},
        // 上游的响应体（含错误码、类型）可能回显 Key：读出来之前就去掉
        { timeoutMs: 20_000, redact: [bearer] },
      )
    } catch (err) {
      throw redactProviderError(err, [bearer])
    }
    if (raw.status < 200 || raw.status >= 300) {
      return {
        kind: 'http',
        status: raw.status,
        code: upstreamErrorCode(protocol, raw.json) ?? `HTTP_${raw.status}`,
        error: redactText(`HTTP ${raw.status}${raw.text ? ` · ${raw.text.slice(0, 180)}` : ''}`, [
          bearer,
        ]),
      }
    }
    return { kind: 'ok', items: req.parse(raw.json) }
  }

  async test(id: string): Promise<TestConnectionResult> {
    const cfg = await this.require(id)
    try {
      // 统一取凭据：登录方式下会先刷新令牌；需要重新登录时给出明确的失败信息
      const bearer = (await this.credential(cfg)).bearer
      return await testProvider(cfg, bearer, this.d.executor)
    } catch (err) {
      return {
        outcome: 'failed',
        error: err instanceof Error ? err.message : String(err),
        // 和任务失败时同一套码（LOGIN_REQUIRED / TIMEOUT / NETWORK / HTTP_<状态> …）
        ...(err instanceof ProviderError ? { code: err.code } : {}),
      }
    }
  }

  private async credential(cfg: ProviderConfig) {
    const resolver = this.d.credentials
    if (resolver) return resolver.resolve(cfg)
    const key = cfg.secretRef ? await this.d.secrets.get(cfg.secretRef) : undefined
    return { method: effectiveAuth(cfg).type, bearer: key }
  }

  // === 账号登录 ===

  private requireLogin(cfg: ProviderConfig): LoginService {
    const auth = effectiveAuth(cfg)
    const service = auth.type === 'account_login' ? this.d.logins?.[auth.channel] : undefined
    if (!service) throw conflict('LOGIN_NOT_SUPPORTED', '这个服务商不是账号登录方式')
    return service
  }

  async loginStatus(cfg: ProviderConfig, origin: LoginRequestOrigin = {}): Promise<LoginStatusDto> {
    const availability = loginAvailability(origin)
    const auth = effectiveAuth(cfg)
    const channel: LoginChannelId = auth.type === 'account_login' ? auth.channel : 'openai-chatgpt'
    const service = this.d.logins?.[channel]
    if (!service) return { channel, state: 'signed_out', availability }
    return { ...(await service.status(cfg.id, cfg.secretRef)), availability }
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
    const { revoked, manageUrl } = await this.requireLogin(cfg).logout(cfg.id, cfg.secretRef)
    return {
      status: await this.loginStatus(cfg, origin),
      revoked,
      ...(manageUrl ? { manageUrl } : {}),
    }
  }

  /**
   * 这个服务商当前能用的模型。支持列表接口的协议（openai-chat / openai-responses / anthropic-messages /
   * gemini-chat / openai-images / gemini-image / openai-tts）取列表，上游给什么就是什么；其余图片、视频、语音协议
   * 没有统一的列表接口，返回 `MODEL_LIST_UNSUPPORTED`。非 2xx 时 502，信息里带上游响应体的前 180 个字符（已去掉凭据）。
   * 登录方式下取 `/v1/models` 里 `visibility == "list"` 的那些。
   */
  async models(id: string): Promise<Array<{ id: string; label: string }>> {
    const cfg = await this.require(id)
    let bearer: string | undefined
    try {
      bearer = (await this.credential(cfg)).bearer
    } catch (err) {
      if (err instanceof ProviderError && err.code === 'LOGIN_ENDPOINT_NOT_ALLOWED') {
        throw new HttpError(400, 'AUTH_NOT_ALLOWED', err.message)
      }
      throw err
    }
    const listed = await this.listModels(
      cfg.protocol,
      cfg.baseUrl,
      bearer,
      cfg.dialect?.extraHeaders,
    )
    if (listed.kind === 'unsupported')
      throw conflict('MODEL_LIST_UNSUPPORTED', '这个服务商的协议没有模型列表')
    if (listed.kind === 'http') {
      throw new HttpError(502, 'PROVIDER_REQUEST_FAILED', `服务商返回 ${listed.error}`, {
        status: listed.status,
        code: listed.code,
      })
    }
    return listed.items
  }

  capability(cfg: ProviderConfig) {
    const found = this.d.models.lookup(cfg)
    const speechInputs = speechInputSupportOf(cfg)
    return {
      declared: found.declared,
      capability: found.capability,
      ...(speechInputs ? { speechInputs } : {}),
      ...(speechInputs ? { speechDefaultVoice: speechDefaultVoiceOf(cfg, this.d.models) } : {}),
      pricing: found.profile?.pricing ?? [],
      quirks: found.profile?.quirks ?? [],
      provenance: found.profile?.provenance,
    }
  }
}
