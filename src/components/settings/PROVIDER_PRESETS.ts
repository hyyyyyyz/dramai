import type { ProviderKind } from '@/types/domain'

export interface ProviderPreset {
  id: string
  label: string
  kind: ProviderKind
  baseUrl: string
  /** 推荐填的 model，用户可改。 */
  suggestedModel: string
  notes?: string
}

/**
 * 预设服务商。用户挑一个、填上 API Key 即可使用，无需手敲 base URL。
 *
 * 列表整理自 docs/PROVIDERS.md，以浏览器可直连（CORS 友好）的为主。
 * dramai 与各服务商无任何商业合作。
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openrouter-llm',
    label: 'OpenRouter (LLM)',
    kind: 'llm',
    baseUrl: 'https://openrouter.ai/api/v1',
    suggestedModel: 'anthropic/claude-sonnet-4.6',
    notes: 'CORS 友好，一个 key 调主流大模型',
  },
  {
    id: '302-llm',
    label: '302.AI (LLM)',
    kind: 'llm',
    baseUrl: 'https://api.302.ai/v1',
    suggestedModel: 'gpt-4o-mini',
    notes: 'CORS 友好，国内可访问',
  },
  {
    id: 'ciyuan-llm',
    label: '词元 (LLM)',
    kind: 'llm',
    baseUrl: 'https://ciyuan.today/v1',
    suggestedModel: 'gpt-4o-mini',
  },
  {
    id: 'openai-llm',
    label: 'OpenAI (LLM)',
    kind: 'llm',
    baseUrl: 'https://api.openai.com/v1',
    suggestedModel: 'gpt-4.1-mini',
    notes: '官方 API，CORS 不友好，多数情况下需 BFF 转发',
  },
  {
    id: '302-image',
    label: '302.AI (文生图)',
    kind: 'text2image',
    baseUrl: 'https://api.302.ai/v1',
    suggestedModel: 'gpt-image-1',
  },
  {
    id: 'openrouter-image',
    label: 'OpenRouter (文生图)',
    kind: 'text2image',
    baseUrl: 'https://openrouter.ai/api/v1',
    suggestedModel: 'openai/gpt-image-1',
  },
]

export const PROVIDER_KIND_LABEL: Record<ProviderKind, string> = {
  llm: 'LLM 文本生成',
  text2image: '文生图',
  image2video: '图生视频',
  imageEdit: '图片编辑',
}
