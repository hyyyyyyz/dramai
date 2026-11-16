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
  'minimax-t2a': 'tts',
  'dashscope-cosyvoice': 'tts',
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
  tts: ['openai-tts', 'minimax-t2a', 'dashscope-cosyvoice'],
}

/**
 * Interface types that can no longer be picked when adding a provider. Providers saved with one of them still show,
 * edit, test and generate as before, and the names stay.
 * - `aliyun-video`, `volcengine-video`: their requests carry a path prefix (`/aliyun/…`, `/volcengine/…`) that exists
 *   only on the relay platform that was taken out, so the vendors' own addresses answer 404 for them (the vendors'
 *   own interfaces are `dashscope-video` and `ark-video`).
 * - `kling-video`: the old-version path with a static Bearer key; the vendor's old-version interface wants a JWT
 *   signed with an access/secret key pair, so a key pasted into it is very likely refused (the vendor's current
 *   interface is `kling-contents`).
 */
export const NOT_ADDABLE: ReadonlySet<ProtocolId> = new Set([
  'aliyun-video',
  'volcengine-video',
  'kling-video',
])

/** What the "Add provider" form offers per kind: `PROTOCOLS_BY_KIND` without the ones that cannot be added any more. */
export const ADDABLE_PROTOCOLS_BY_KIND: Record<ProviderKind, readonly ProtocolId[]> = {
  llm: PROTOCOLS_BY_KIND.llm.filter((p) => !NOT_ADDABLE.has(p)),
  image: PROTOCOLS_BY_KIND.image.filter((p) => !NOT_ADDABLE.has(p)),
  video: PROTOCOLS_BY_KIND.video.filter((p) => !NOT_ADDABLE.has(p)),
  tts: PROTOCOLS_BY_KIND.tts.filter((p) => !NOT_ADDABLE.has(p)),
}

export const kindOfProtocol = (p: ProtocolId): ProviderKind => KIND_OF[p]
export const ALL_PROTOCOLS = Object.keys(KIND_OF) as ProtocolId[]

/**
 * Interface types whose server can list their models (`providers.models`, `providers.probe` with `models`): the card
 * shows "Get model list" for these only. A test holds it to what the real server answers for every interface type
 * (tests/fixtures/add-provider/recorded-probe.json, `modelsByProtocol`).
 */
export const LISTS_MODELS: ReadonlySet<ProtocolId> = new Set([
  'openai-chat',
  'openai-responses',
  'anthropic-messages',
  'gemini-chat',
  'openai-images',
  'gemini-image',
  'openai-tts',
])

/** The display name of a protocol. A protocol with no copy shows its id instead of breaking the page. */
export function protocolLabel(t: TFunction, p: string): string {
  return t(`protocol.${p}` as never, { defaultValue: p }) as string
}
