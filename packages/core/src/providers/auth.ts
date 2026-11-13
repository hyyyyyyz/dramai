import { ProviderError } from './errors.ts'
import type { LoginChannelId, ProtocolId, ProviderAuth, ProviderConfig } from './types.ts'
import { LOGIN_CHANNELS } from './types.ts'

/**
 * 鉴权方式的解析。
 *
 * - 新数据带 `auth`；旧数据没有：有 Key（`secretRef`）的按 API Key，没有的按无需鉴权。
 *   这是读取时的推断，不改存储——旧库升级后原有服务商照常可用，用户第一次保存时才写入 `auth`。
 * - 凭据只存在 SecretStore。调用前由 `CredentialResolver` 统一取出（登录方式下顺带刷新），
 *   作为 `AuthContext` 交给适配器。
 */
export function effectiveAuth(config: Pick<ProviderConfig, 'auth' | 'secretRef'>): ProviderAuth {
  if (config.auth) return config.auth
  return config.secretRef ? { type: 'api_key' } : { type: 'none' }
}

export const isLoginChannel = (value: string): value is LoginChannelId =>
  (LOGIN_CHANNELS as readonly string[]).includes(value)

/**
 * 登录通道只能把令牌发到官方的公开接口：地址和协议是钉死的。这让"只调公开接口"成为代码保证——
 * 不管配置里存了什么（创建、修改、旧数据），令牌都不会作为 Bearer 发到别处。
 */
export const LOGIN_CHANNEL_ENDPOINTS: Record<
  LoginChannelId,
  { baseUrl: string; protocol: ProtocolId }
> = {
  'openai-chatgpt': { baseUrl: 'https://api.openai.com/v1', protocol: 'openai-responses' },
}

/** 地址是不是这个通道允许的那一个（规范化后比较：https、主机、路径；不接受用户信息、端口、查询串）。 */
export function isAllowedLoginBaseUrl(channel: LoginChannelId, baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.trim())
    const allowed = new URL(LOGIN_CHANNEL_ENDPOINTS[channel].baseUrl)
    return (
      url.protocol === allowed.protocol &&
      url.hostname.toLowerCase() === allowed.hostname &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      url.pathname.replace(/\/+$/, '') === allowed.pathname.replace(/\/+$/, '')
    )
  } catch {
    return false
  }
}

/** 登录方式的服务商配置哪里不合规（接口地址或协议不是通道指定的）；合规返回 undefined。 */
export function loginEndpointProblem(
  channel: LoginChannelId,
  config: Pick<ProviderConfig, 'baseUrl' | 'protocol'>,
): string | undefined {
  const fixed = LOGIN_CHANNEL_ENDPOINTS[channel]
  if (config.protocol !== fixed.protocol) {
    return `账号登录只能用于 ${fixed.protocol} 协议`
  }
  if (!isAllowedLoginBaseUrl(channel, config.baseUrl)) {
    return `账号登录的接口地址固定为 ${fixed.baseUrl}，令牌不会发到别的地址`
  }
  return undefined
}

/** 发请求前的最后一道核对（也保护已经存下来的数据）。 */
export function assertLoginEndpoint(channel: LoginChannelId, config: ProviderConfig): void {
  const problem = loginEndpointProblem(channel, config)
  if (problem)
    throw new ProviderError('capability', problem, { code: 'LOGIN_ENDPOINT_NOT_ALLOWED' })
}

export interface ResolvedCredential {
  method: ProviderAuth['type']
  channel?: LoginChannelId
  /** 放进 `Authorization: Bearer` 的值；无需鉴权时为空。 */
  bearer?: string
}

/** 取凭据的统一入口。登录方式下令牌临近过期会自动刷新（同一账号的并发刷新只发一次）。 */
export interface CredentialResolver {
  resolve(config: ProviderConfig): Promise<ResolvedCredential>
}

/** 一个登录通道要实现的：给出当前有效的访问令牌（必要时刷新）；刷新不了就抛 `LoginRequiredError`。 */
export interface LoginChannel {
  readonly id: LoginChannelId
  accessToken(config: ProviderConfig, signal?: AbortSignal): Promise<string>
}

/** 需要（重新）登录：没登录过、令牌被撤销或刷新令牌已不可用。和普通网络错误是两回事。 */
export class LoginRequiredError extends ProviderError {
  readonly channel: LoginChannelId
  readonly reason: 'not_signed_in' | 'refresh_failed' | 'plan_usage_not_granted'
  constructor(
    channel: LoginChannelId,
    reason: LoginRequiredError['reason'],
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super('auth', message, { code: 'LOGIN_REQUIRED', cause: options.cause })
    this.name = 'LoginRequiredError'
    this.channel = channel
    this.reason = reason
  }
}

export interface CredentialResolverDeps {
  secrets: { get(ref: string): Promise<string | undefined> }
  channels?: Partial<Record<LoginChannelId, LoginChannel>>
}

export function createCredentialResolver(deps: CredentialResolverDeps): CredentialResolver {
  return {
    async resolve(config) {
      const auth = effectiveAuth(config)
      if (auth.type === 'none') return { method: 'none' }
      if (auth.type === 'api_key') {
        const key = config.secretRef ? await deps.secrets.get(config.secretRef) : undefined
        return { method: 'api_key', bearer: key }
      }
      const channel = deps.channels?.[auth.channel]
      if (!channel) {
        throw new LoginRequiredError(
          auth.channel,
          'not_signed_in',
          `这个服务商用账号登录，但登录通道 ${auth.channel} 不可用`,
        )
      }
      assertLoginEndpoint(auth.channel, config)
      return {
        method: 'account_login',
        channel: auth.channel,
        bearer: await channel.accessToken(config),
      }
    },
  }
}
