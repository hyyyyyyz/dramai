import type { LoginChannel } from '../auth.ts'
import type { LoginChannelId } from '../types.ts'

/**
 * 各个登录通道共用的类型：状态、回调监听器、通道服务接口。服务端的 `providers.login.*` 路由按服务商的
 * `auth.channel` 选通道，所以每个通道只要实现 `LoginService`。
 */

export type LoginErrorCode =
  | 'user_denied'
  | 'authorization_error'
  | 'state_mismatch'
  | 'no_code'
  | 'registration_incomplete'
  | 'client_mismatch'
  | 'invalid_grant'
  | 'exchange_failed'
  | 'bad_signature'
  | 'issuer_mismatch'
  | 'audience_mismatch'
  | 'expired'
  | 'nonce_mismatch'
  | 'bad_id_token'
  | 'account_mismatch'
  | 'timeout'
  | 'cancelled'
  | 'refresh_rejected'

export type LoginState = 'signed_out' | 'pending' | 'signed_in' | 'needs_relogin'

/**
 * 对外的登录状态：**没有任何令牌或 Key**。字段按通道取用，不适用的不出现：
 * - OpenAI：`account`（邮箱）、`expiresAt`、`planUsage`；
 * - OpenRouter：`credential`（换回的 Key 的掩码，`kind: 'api_key'`）、`manageUrl`；没有账号标识、没有到期。
 */
export interface LoginStatus {
  channel: LoginChannelId
  state: LoginState
  /** 账号的显示标识（邮箱）。通道拿不到就没有。 */
  account?: { label: string }
  /** 访问令牌的到期时间（ISO）。没有到期概念的通道没有。 */
  expiresAt?: string
  /** 授予了 ChatGPT 用量；false = 已登录但不能调用。只有 OpenAI 通道有。 */
  planUsage?: boolean
  /** 登录换回的凭据：`access_token`（会刷新的令牌）或 `api_key`（登录得到的一把用户自己的 Key，不刷新）。 */
  credential?: { kind: 'access_token' | 'api_key'; mask?: string }
  /** 在厂商那里管理 / 作废这份授权的页面（通道没有撤销接口时用户靠它）。 */
  manageUrl?: string
  pending?: { expiresAt: string }
  lastError?: { code: LoginErrorCode; message: string; at: string }
}

export interface LoopbackListener {
  /** 例如 `http://127.0.0.1:1455/auth/callback`。 */
  redirectUri: string
  close(): void
}

export interface ListenerOptions {
  /** 回调地址里的主机：OpenAI 要 `127.0.0.1`，OpenRouter 官方文档只写了 `localhost`。缺省 `127.0.0.1`。 */
  host?: '127.0.0.1' | 'localhost'
  path?: string
  /** 优先用的端口；0 = 让系统选。缺省按通道（OpenAI 先试 1455）。 */
  preferredPort?: number
}

/** 起一个只在回环地址上监听的回调接收器。收到回调时调用 `onCallback`，把结果展示给浏览器。 */
export type ListenerFactory = (
  onCallback: (params: URLSearchParams) => Promise<{ ok: boolean; error?: LoginErrorCode }>,
  options?: ListenerOptions,
) => Promise<LoopbackListener>

/** 一个登录通道给服务端用的全部操作。 */
export interface LoginService extends LoginChannel {
  start(
    providerId: string,
    secretRef: string,
    options?: { account?: 'same' | 'new' },
  ): Promise<{ authorizationUrl: string; redirectUri: string; expiresAt: string }>
  cancel(providerId: string): boolean
  status(providerId: string, secretRef: string | undefined): Promise<LoginStatus>
  logout(
    providerId: string,
    secretRef: string | undefined,
  ): Promise<{
    revoked: 'confirmed' | 'unconfirmed' | 'nothing_to_revoke'
    /** 通道没有撤销接口时，用户去哪里作废这份授权。 */
    manageUrl?: string
  }>
  dispose(): void
}
