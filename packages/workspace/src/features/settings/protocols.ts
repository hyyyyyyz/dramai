import type { ProviderConfigDto } from '@dramai/api'

export type ProviderKind = ProviderConfigDto['kind']
export type ProtocolId = ProviderConfigDto['protocol']

export const KINDS: readonly ProviderKind[] = ['llm', 'image', 'video', 'tts']

/** 每类服务能选的 API 协议。 */
export const PROTOCOLS_BY_KIND: Record<ProviderKind, readonly ProtocolId[]> = {
  llm: ['openai-chat'],
  image: ['openai-images', 'gemini-image'],
  video: ['aliyun-video', 'volcengine-video', 'kling-video', 'generic-video'],
  tts: ['openai-tts'],
}
