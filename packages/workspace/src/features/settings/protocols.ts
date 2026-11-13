import type { TFunction } from 'i18next'
import type { ProviderConfigDto } from '@dramai/api'

export type ProviderKind = ProviderConfigDto['kind']
export type ProtocolId = ProviderConfigDto['protocol']

export const KINDS: readonly ProviderKind[] = ['llm', 'image', 'video', 'tts']

/**
 * Which kind of service each API protocol serves. A `Record` over every protocol, so adding a protocol to the contract
 * fails the type check right here, in one place (and a test checks every protocol has a name in every language),
 * instead of in every component that shows a protocol name.
 */
const KIND_OF: Record<ProtocolId, ProviderKind> = {
  'openai-chat': 'llm',
  'openai-responses': 'llm',
  'anthropic-messages': 'llm',
  'gemini-chat': 'llm',
  'openai-images': 'image',
  'gemini-image': 'image',
  'volcengine-images': 'image',
  'dashscope-image': 'image',
  'siliconflow-images': 'image',
  'kling-image': 'image',
  'aliyun-video': 'video',
  'volcengine-video': 'video',
  'kling-video': 'video',
  'generic-video': 'video',
  'ark-video': 'video',
  'kling-contents': 'video',
  'dashscope-video': 'video',
  'openai-tts': 'tts',
}

/** Protocols a custom provider of each kind can pick, in the order shown. */
export const PROTOCOLS_BY_KIND: Record<ProviderKind, readonly ProtocolId[]> = {
  llm: ['openai-chat', 'openai-responses', 'anthropic-messages', 'gemini-chat'],
  image: [
    'openai-images',
    'gemini-image',
    'volcengine-images',
    'dashscope-image',
    'siliconflow-images',
    'kling-image',
  ],
  video: [
    'aliyun-video',
    'volcengine-video',
    'kling-video',
    'generic-video',
    'ark-video',
    'kling-contents',
    'dashscope-video',
  ],
  tts: ['openai-tts'],
}

export const kindOfProtocol = (p: ProtocolId): ProviderKind => KIND_OF[p]
export const ALL_PROTOCOLS = Object.keys(KIND_OF) as ProtocolId[]

/** Text protocols that can list their models (`providers.models`). */
export const LISTS_MODELS: ReadonlySet<ProtocolId> = new Set([
  'openai-chat',
  'openai-responses',
  'anthropic-messages',
  'gemini-chat',
])

/** The display name of a protocol. A protocol with no copy shows its id instead of breaking the page. */
export function protocolLabel(t: TFunction, p: string): string {
  return t(`protocol.${p}` as never, { defaultValue: p }) as string
}
