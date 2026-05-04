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
    id: 'deepseek-llm',
    label: 'DeepSeek 直连 (LLM)',
    kind: 'llm',
    baseUrl: 'https://api.deepseek.com',
    suggestedModel: 'deepseek-chat',
    notes: 'CORS 友好，官方直连，中文极强 + 便宜',
  },
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
  {
    id: '302-image-seedream',
    label: '302.AI · 即梦 Seedream 5.0 (字节，便宜)',
    kind: 'text2image',
    // 验证可用（2026-05）：POST https://api.302.ai/doubao/images/generations
    //   { "model": "doubao-seedream-5-0-260128", "prompt": "...", ... }
    // 是 OpenAI Images API 兼容变体，只是 path 在 /doubao/ 子路径下，
    // model id 必须带 doubao- 前缀（302 网页 URL slug "seedream-5-0-260128" 不是 model id）。
    baseUrl: 'https://api.302.ai/doubao',
    suggestedModel: 'doubao-seedream-5-0-260128',
    apiFlavor: 'openai-compatible',
    notes:
      '约 0.035 PTC/张，比 Nano Banana 便宜约 5 倍；纯文生图可用，图生图（参考图）当前不通——doubao 期望参考图是 URL 数组，dramai 现在传的是 base64 dataURL（locked character 暂时只能靠描述生效）',
  },

  // === 文生图（Gemini 原生协议）===
  {
    id: '302-image-nano-banana',
    label: '302.AI · Nano Banana (Gemini 文生图)',
    kind: 'text2image',
    baseUrl: 'https://api.302.ai',
    // 验证可用（2026-05）：POST https://api.302.ai/v1beta/models/gemini-2.5-flash-image:generateContent
    // 302 网页上同时列出 "gemini-2.5-flash-image-v1beta（官方格式）" —— 那是产品命名，
    // 不是 model id 本身；真正请求里的 model 段还是不带后缀的 gemini-2.5-flash-image。
    suggestedModel: 'gemini-2.5-flash-image',
    apiFlavor: 'gemini',
    notes:
      '⚠️ base URL 不带 /v1（Gemini 协议自己的路径就是 /v1beta/models/{model}:generateContent）',
  },

  // === 图生视频 ===
  {
    id: '302-i2v-seedance-fast',
    label: '302.AI · 即梦 Seedance 2.0 Fast (字节，便宜)',
    kind: 'image2video',
    // ⚠️ 默认走国内中转 api.302ai.cn —— 直连 api.302.ai 在 /volcengine/ 路径上
    // 浏览器会被 CORS 拦截：请求成功送达且扣 token，但响应没 CORS 头被浏览器拒收，
    // dramai 看到 "Failed to fetch" 但 token 已经被扣（已发生过实际损失，2026-05）。
    // 协议（来自 302 OpenAPI Spec）：
    //   POST {base}/volcengine/api/v3/contents/generations/tasks
    //   { model, content[], ratio, duration, resolution, generate_audio, watermark }
    //   起始帧支持 base64 dataURL（spec example 5），dramai 直接发，无需图床。
    //   返回 { id: "cgt-..." }，再 GET .../tasks/{id} 轮询。
    baseUrl: 'https://api.302ai.cn',
    suggestedModel: 'doubao-seedance-2-0-fast-260128',
    apiFlavor: 'volcengine',
    notes:
      '⚠️ 用国内中转 api.302ai.cn（直连 .ai 域名 CORS 不通会扣钱无结果）；价格 ~6.5 PTC/1M token，5 秒 720p 通常几毛到 1 块多',
  },
  {
    id: '302-i2v-seedance-pro',
    label: '302.AI · 即梦 Seedance 2.0 (标准版)',
    kind: 'image2video',
    baseUrl: 'https://api.302ai.cn',
    suggestedModel: 'doubao-seedance-2-0-260128',
    apiFlavor: 'volcengine',
    notes: '比 Fast 版贵约 20%，画质更稳定；同样用 .cn 中转避开 CORS',
  },
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
