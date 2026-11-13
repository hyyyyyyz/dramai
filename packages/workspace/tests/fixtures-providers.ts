import type { LoginStatusDto } from '@dramai/api'
import { makeProvider } from './fixtures-production'

export const makeLogin = (patch: Partial<LoginStatusDto> = {}): LoginStatusDto => ({
  channel: 'openai-chatgpt',
  state: 'signed_out',
  availability: { available: true },
  ...patch,
})

/** An LLM provider that signs in with a ChatGPT account. */
export const makeLoginProvider = (
  patch: Record<string, unknown> = {},
  login: Partial<LoginStatusDto> = {},
) =>
  makeProvider({
    id: 'prov_login',
    label: 'OpenAI (ChatGPT sign-in)',
    kind: 'llm',
    protocol: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5',
    auth: { type: 'account_login', channel: 'openai-chatgpt' },
    hasKey: false,
    keyMask: undefined,
    verification: { status: 'documented', source: 'https://developers.openai.com/siwc' },
    login: makeLogin(login),
    ...patch,
  })

export const makeKeyProvider = (patch: Record<string, unknown> = {}) =>
  makeProvider({
    id: 'prov_key',
    label: 'DeepSeek',
    kind: 'llm',
    protocol: 'openai-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    verification: { status: 'tested', testedAt: '2026-05-04' },
    ...patch,
  })

export const makePreset = (patch: Record<string, unknown> = {}) => ({
  id: 'p1',
  label: 'DeepSeek',
  kind: 'llm' as const,
  protocol: 'openai-chat' as const,
  baseUrl: 'https://api.deepseek.com/v1',
  suggestedModel: 'deepseek-chat',
  auth: { type: 'api_key' as const },
  notes: '',
  verification: { status: 'tested' as const, testedAt: '2026-05-04' },
  verifiedAt: '2026-05-04',
  knownLimitations: [],
  ...patch,
})
