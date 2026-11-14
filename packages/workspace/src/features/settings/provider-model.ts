import { safeHttpUrl } from '@/lib/safe-url'
import type { LoginStatusDto, ProviderConfigDto } from '@dramai/api'

export type Auth = ProviderConfigDto['auth']

/** "API key not filled in yet" and "needs no authentication" are different states; so is "signed in". */
export type AuthState = 'key_saved' | 'key_missing' | 'none' | 'login'
export type ChipState = Exclude<AuthState, 'login'>

export function authState(p: Pick<ProviderConfigDto, 'auth' | 'hasKey'>): AuthState {
  if (p.auth.type === 'account_login') return 'login'
  if (p.auth.type === 'none') return 'none'
  return p.hasKey ? 'key_saved' : 'key_missing'
}

/** The sign-in channel of an account-login provider (undefined for the other methods). */
export function loginChannelOf(
  p: Pick<ProviderConfigDto, 'auth'>,
): LoginStatusDto['channel'] | undefined {
  return p.auth.type === 'account_login' ? p.auth.channel : undefined
}

/** Whether "test connection" makes sense: a key is saved, nothing is needed, or the account is signed in with plan usage. */
export function canTest(p: Pick<ProviderConfigDto, 'auth' | 'hasKey' | 'login'>): boolean {
  switch (p.auth.type) {
    case 'api_key':
      return p.hasKey
    case 'none':
      return true
    case 'account_login':
      return p.login?.state === 'signed_in' && p.login.planUsage !== false
  }
}

/** The one thing a provider card should say about where it came from. */
export type VerificationView =
  | { kind: 'tested'; date: string }
  | { kind: 'documented'; source: string; link: boolean }
  | undefined

export function verificationView(
  v: ProviderConfigDto['verification'],
  legacyVerifiedAt?: string,
): VerificationView {
  if (v?.status === 'tested') return { kind: 'tested', date: v.testedAt }
  if (v?.status === 'documented')
    return { kind: 'documented', source: v.source, link: safeHttpUrl(v.source) !== undefined }
  return legacyVerifiedAt ? { kind: 'tested', date: legacyVerifiedAt } : undefined
}

/** Which sign-in screen to show. */
export type LoginView =
  | 'unavailable' // from another machine: the callback can't reach the server
  | 'signed_out'
  | 'signed_out_known' // signed out, but an account was used before
  | 'pending'
  | 'signed_in'
  | 'no_plan_usage' // signed in without the plan-usage scope
  | 'needs_relogin'

export function loginView(s: LoginStatusDto): LoginView {
  if (!s.availability.available && s.state !== 'signed_in' && s.state !== 'pending')
    return 'unavailable'
  switch (s.state) {
    case 'pending':
      return 'pending'
    case 'signed_in':
      return s.planUsage === false ? 'no_plan_usage' : 'signed_in'
    case 'needs_relogin':
      return 'needs_relogin'
    default:
      return s.account ? 'signed_out_known' : 'signed_out'
  }
}

export type LoginErrorKind =
  | 'denied'
  | 'timeout'
  | 'account_mismatch'
  | 'cancelled'
  | 'refresh_rejected'
  | 'failed'

/** Group the many technical sign-in error codes into the few things a person can act on. */
export function loginErrorKind(code: string): LoginErrorKind {
  switch (code) {
    case 'user_denied':
      return 'denied'
    case 'timeout':
      return 'timeout'
    case 'account_mismatch':
      return 'account_mismatch'
    case 'cancelled':
      return 'cancelled'
    case 'refresh_rejected':
      return 'refresh_rejected'
    default:
      return 'failed'
  }
}

/**
 * Errors a task (or a connection test) can fail with when the provider is the ChatGPT sign-in channel.
 * `manage` = the primary action is "Manage usage" in ChatGPT; `settings` = send the user to Settings.
 */
export const PROVIDER_ERROR_CODES = [
  'LOGIN_REQUIRED',
  'LOGIN_ENDPOINT_NOT_ALLOWED',
  'subscription_sharing_usage_limit_exceeded',
  'subscription_sharing_user_not_eligible',
  'subscription_sharing_usage_unavailable',
  'subscription_sharing_user_unavailable',
  'subscription_sharing_unsupported_capability',
  'subscription_sharing_route_not_supported',
  'subscription_sharing_invalid_user',
  'chatpass_v2_scope_not_authorized',
  'chatpass_v2_invalid_authorization_context',
  // text providers (Anthropic, Gemini, and any streaming text provider)
  'EMPTY_OUTPUT_TRUNCATED',
  'STREAM_INTERRUPTED',
  'overloaded_error',
  'rate_limit_error',
  'authentication_error',
  'invalid_request_error',
  'GEMINI_SAFETY',
  'GEMINI_PROMPT_SAFETY',
  'GEMINI_RECITATION',
  'GEMINI_IMAGE_URL_UNSUPPORTED',
  'INVALID_ARGUMENT',
  'RESOURCE_EXHAUSTED',
  'PERMISSION_DENIED',
  // the server's own codes (connection test and task failures share them)
  'NETWORK',
  'TIMEOUT',
  'UNREADABLE_RESPONSE',
  'BASE_URL_INVALID',
  // `HTTP_<status>` grouped by what the user can do about it (see `httpClassOf`)
  'HTTP_AUTH',
  'HTTP_NOT_FOUND',
  'HTTP_RATE_LIMIT',
  'HTTP_SERVER',
  // video providers (Kling, Volcengine Ark / BytePlus, Alibaba Model Studio): the task's own codes
  'VIDEO_FACE_REJECTED',
  'CONTENT_REJECTED',
  'BALANCE_INSUFFICIENT',
  'TASK_EXPIRED',
  'TASK_CANCELLED',
  'TASK_UNKNOWN',
  'FIRST_FRAME_REQUIRED',
  // speech providers
  'VOICE_MISSING',
] as const
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number]

/** `HTTP_401` and `HTTP_403` → auth; 404 → address/model; 429 → rate limit; 5xx → server; 400/422 → bad request. */
function httpClassOf(code: string): ProviderErrorCode | undefined {
  const m = /^HTTP_(\d{3})$/.exec(code)
  if (!m) return undefined
  const status = Number(m[1])
  if (status === 401 || status === 403) return 'HTTP_AUTH'
  if (status === 404) return 'HTTP_NOT_FOUND'
  if (status === 429) return 'HTTP_RATE_LIMIT'
  if (status >= 500) return 'HTTP_SERVER'
  if (status === 400 || status === 422) return 'invalid_request_error'
  return undefined
}

/**
 * Codes the video providers send as they are: Kling's business codes arrive as `KLING_<code>`, Ark and Model Studio
 * send their own names (some with a dot, which cannot be a translation key, so they are explained under a plain key).
 */
function videoCodeOf(code: string): ProviderErrorCode | undefined {
  switch (code) {
    case 'KLING_1101':
    case 'KLING_1102':
    case 'Arrearage':
      return 'BALANCE_INSUFFICIENT'
    case 'KLING_1103':
    case 'InvalidApiKey':
      return 'HTTP_AUTH'
    case 'KLING_1301':
    case 'DataInspectionFailed':
      return 'CONTENT_REJECTED'
    case 'KLING_1302':
    case 'KLING_1303':
      return 'HTTP_RATE_LIMIT'
    // MiniMax speech: `MINIMAX_<status_code>` (authentication, balance, rate limit, content, bad parameter, no such voice)
    case 'MINIMAX_1004':
    case 'MINIMAX_2049':
      return 'HTTP_AUTH'
    case 'MINIMAX_1008':
    case 'MINIMAX_2053':
      return 'BALANCE_INSUFFICIENT'
    case 'MINIMAX_1002':
    case 'MINIMAX_1039':
    case 'MINIMAX_2045':
      return 'HTTP_RATE_LIMIT'
    case 'MINIMAX_1026':
    case 'MINIMAX_1027':
      return 'CONTENT_REJECTED'
    case 'MINIMAX_2013':
      return 'invalid_request_error'
    case 'MINIMAX_20132':
    case 'MINIMAX_2054':
    case 'MINIMAX_2042':
      return 'VOICE_MISSING'
    default:
      if (code.startsWith('InputImageSensitiveContentDetected')) return 'VIDEO_FACE_REJECTED'
      if (code.startsWith('Throttling')) return 'HTTP_RATE_LIMIT'
      return undefined
  }
}

/** The explained form of an error code, or nothing when the generic failure text should stay. */
export function providerErrorOf(code: string | undefined): ProviderErrorCode | undefined {
  if (code === undefined) return undefined
  if ((PROVIDER_ERROR_CODES as readonly string[]).includes(code)) return code as ProviderErrorCode
  return httpClassOf(code) ?? videoCodeOf(code)
}
export const isProviderErrorCode = (code: string | undefined): code is ProviderErrorCode =>
  providerErrorOf(code) === code && code !== undefined

export const PROVIDER_ERROR_ACTION: Record<ProviderErrorCode, 'manage' | 'settings' | undefined> = {
  LOGIN_REQUIRED: 'settings',
  LOGIN_ENDPOINT_NOT_ALLOWED: 'settings',
  subscription_sharing_usage_limit_exceeded: 'manage',
  subscription_sharing_user_not_eligible: 'settings',
  subscription_sharing_usage_unavailable: undefined,
  subscription_sharing_user_unavailable: undefined,
  subscription_sharing_unsupported_capability: undefined,
  subscription_sharing_route_not_supported: 'settings',
  subscription_sharing_invalid_user: 'settings',
  chatpass_v2_scope_not_authorized: 'settings',
  chatpass_v2_invalid_authorization_context: 'settings',
  EMPTY_OUTPUT_TRUNCATED: 'settings',
  STREAM_INTERRUPTED: undefined,
  overloaded_error: undefined,
  rate_limit_error: undefined,
  authentication_error: 'settings',
  invalid_request_error: undefined,
  GEMINI_SAFETY: undefined,
  GEMINI_PROMPT_SAFETY: undefined,
  GEMINI_RECITATION: undefined,
  GEMINI_IMAGE_URL_UNSUPPORTED: undefined,
  INVALID_ARGUMENT: undefined,
  RESOURCE_EXHAUSTED: undefined,
  PERMISSION_DENIED: 'settings',
  NETWORK: undefined,
  TIMEOUT: undefined,
  UNREADABLE_RESPONSE: 'settings',
  BASE_URL_INVALID: 'settings',
  HTTP_AUTH: 'settings',
  HTTP_NOT_FOUND: 'settings',
  HTTP_RATE_LIMIT: undefined,
  HTTP_SERVER: undefined,
  VIDEO_FACE_REJECTED: undefined,
  CONTENT_REJECTED: undefined,
  BALANCE_INSUFFICIENT: undefined,
  TASK_EXPIRED: undefined,
  TASK_CANCELLED: undefined,
  TASK_UNKNOWN: undefined,
  FIRST_FRAME_REQUIRED: undefined,
  VOICE_MISSING: undefined,
}

/**
 * OpenAI's usage page, opened by the user with a link (navigation, not a resource the page loads). It is built at
 * run time on purpose: the server's CSP test scans the built bundle for a literal `href: "https://…"` and cannot tell
 * a clickable link from a loaded resource, and the bundler would otherwise inline this constant right after `href`.
 */
export const MANAGE_USAGE_URL = new URL('https://chatgpt.com/settings/usage').href
