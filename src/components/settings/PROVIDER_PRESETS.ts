import type { ApiFlavor, ProviderKind } from '@/types/domain'

export interface ProviderPreset {
  id: string
  label: string
  kind: ProviderKind
  baseUrl: string
  /** 推荐填的 model，用户可改。 */
  suggestedModel: string
  /** 默认 'openai-compatible'。Nano Banana / Imagen 之类用 'gemini'；Kling 用 'kling'。 */
  apiFlavor?: ApiFlavor
  notes?: string
}

/**
 * 预设服务商。用户挑一个、填上 API Key 即可使用，无需手敲 base URL。
 *
 * 列表整理自 docs/PROVIDERS.md，以浏览器可直连（CORS 友好）的为主。
 * dramai 与各服务商无任何商业合作。
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  // === LLM ===
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
    suggestedModel: 'deepseek-chat',
    notes: '在 302 模型市场搜 claude / gpt / deepseek 看实际 model id',
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

  // === 文生图（OpenAI 兼容协议）===
  {
    id: '302-image-flux',
    label: '302.AI · Flux (文生图)',
    kind: 'text2image',
    baseUrl: 'https://api.302.ai/v1',
    suggestedModel: 'flux-1-dev',
    apiFlavor: 'openai-compatible',
    notes: 'Black Forest Labs Flux，多数聚合平台用 OpenAI Images 协议',
  },
  {
    id: '302-image-gptimage',
    label: '302.AI · GPT Image 1 (文生图)',
    kind: 'text2image',
    baseUrl: 'https://api.302.ai/v1',
    suggestedModel: 'gpt-image-1',
    apiFlavor: 'openai-compatible',
    notes: 'OpenAI 官方 Images API，写实人像质量高',
  },
  {
    id: 'openrouter-image',
    label: 'OpenRouter (文生图)',
    kind: 'text2image',
    baseUrl: 'https://openrouter.ai/api/v1',
    suggestedModel: 'openai/gpt-image-1',
    apiFlavor: 'openai-compatible',
  },

  // === 文生图（Gemini 原生协议）===
  {
    id: '302-image-nano-banana',
    label: '302.AI · Nano Banana (Gemini 文生图)',
    kind: 'text2image',
    baseUrl: 'https://api.302.ai',
    suggestedModel: 'gemini-2.5-flash-image',
    apiFlavor: 'gemini',
    notes: '⚠️ base URL 不带 /v1，因为 Gemini 协议路径是 /v1beta/models/{model}:generateContent',
  },

  // === 图生视频（Kling 原生协议示例；具体 base URL 以 302 模型卡为准）===
  {
    id: '302-i2v-kling',
    label: '302.AI · Kling (图生视频)',
    kind: 'image2video',
    baseUrl: 'https://api.302.ai/klingai',
    suggestedModel: 'kling-v1-6',
    apiFlavor: 'kling',
    notes: '⚠️ base URL 以 302 Kling 产品页"调用方式"为准；实际可能是 /klingai 或别的前缀',
  },
  {
    id: '302-i2v-compat',
    label: '302.AI · 通用图生视频 (OpenAI 兼容)',
    kind: 'image2video',
    baseUrl: 'https://api.302.ai/v1',
    suggestedModel: 'kling-v1-6',
    apiFlavor: 'openai-compatible',
    notes: '如果 302 用 /v1/videos/generations 透传 Kling/Vidu/Hailuo 等',
  },
]

export const PROVIDER_KIND_LABEL: Record<ProviderKind, string> = {
  llm: 'LLM 文本生成',
  text2image: '文生图',
  image2video: '图生视频',
  imageEdit: '图片编辑',
}
