import type { LoginStatusDto, ProviderConfigDto } from '@dramai/api'

export type Auth = ProviderConfigDto['auth']

/** "API key not filled in yet" and "needs no authentication" are different states; so is "signed in". */
export type AuthState = 'key_saved' | 'key_missing' | 'none' | 'login'

export function authState(p: Pick<ProviderConfigDto, 'auth' | 'hasKey'>): AuthState {
  if (p.auth.type === 'account_login') return 'login'
  if (p.auth.type === 'none') return 'none'
  return p.hasKey ? 'key_saved' : 'key_missing'
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
    return { kind: 'documented', source: v.source, link: /^https?:\/\//i.test(v.source) }
  return legacyVerifiedAt ? { kind: 'tested', date: legacyVerifiedAt } : undefined
}

/** Documented-only presets are never the default recommendation: sort them after the tested ones. */
export function sortPresets<T extends { verification: { status: 'tested' | 'documented' } }>(
  list: readonly T[],
): T[] {
  return [...list].sort(
    (a, b) =>
      Number(a.verification.status === 'documented') -
      Number(b.verification.status === 'documented'),
  )
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
] as const
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number]
export const isProviderErrorCode = (code: string | undefined): code is ProviderErrorCode =>
  code !== undefined && (PROVIDER_ERROR_CODES as readonly string[]).includes(code)

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
}

/**
 * OpenAI's usage page, opened by the user with a link (navigation, not a resource the page loads). It is built at
 * run time on purpose: the server's CSP test scans the built bundle for a literal `href: "https://…"` and cannot tell
 * a clickable link from a loaded resource, and the bundler would otherwise inline this constant right after `href`.
 */
export const MANAGE_USAGE_URL = new URL('https://chatgpt.com/settings/usage').href
export const WELCOME_FLAG = 'dramai.openai.welcomed'
