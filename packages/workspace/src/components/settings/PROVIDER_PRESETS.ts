import type { ApiFlavor, ProviderKind } from '@/types/domain'

export interface ProviderPreset {
  id: string
  label: string
  kind: ProviderKind
  baseUrl: string
  /** 推荐填的 model，用户可改。 */
  suggestedModel: string
  /** 默认 'openai-compatible'。Nano Banana / Imagen 之类用 'gemini'；阿里通义用 'aliyun'。 */
  apiFlavor?: ApiFlavor
  notes?: string
}

/**
 * 预设服务商。**只保留经过端到端实测可用的组合**——
 * 未实测的预设不要放进来，否则用户会以为"预设 = 推荐 = 一定能用"，
 * 一次 CORS 或协议问题就会扣冤枉钱（曾经因为 Seedance .ai 域名 CORS
 * 一次扣了 ~8 PTC，惨痛教训）。
 *
 * 验证记录（2026-05-04，hyyyyyyz 端到端跑通的 dramai v0.4 流程）：
 *
 *   LLM         DeepSeek 直连 + deepseek-chat
 *   文生图      Nano Banana  : api.302.ai / gemini-2.5-flash-image / Gemini 协议
 *   文生图      Seedream 5.0 : api.302.ai/doubao / doubao-seedream-5-0-260128 / OpenAI 兼容
 *   图生视频    Wan2.2 Flash : api.302ai.cn / wan2.2-i2v-flash / 阿里 DashScope
 *
 * 加预设前请：(1) 真实跑过；(2) 价格用过；(3) base URL + apiFlavor + model id 都验证；
 *           (4) 写进 notes 里何时验证、价格档。
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  // === LLM ===
  {
    id: 'deepseek-llm',
    label: 'DeepSeek 直连 (LLM)',
    kind: 'llm',
    baseUrl: 'https://api.deepseek.com',
    suggestedModel: 'deepseek-chat',
    notes: 'CORS 友好，官方直连，中文极强 + 便宜。验证 2026-05',
  },

  // === 文生图 ===
  {
    id: '302-image-seedream',
    label: '302.AI · 即梦 Seedream 5.0 (字节，便宜)',
    kind: 'text2image',
    // 协议：POST https://api.302.ai/doubao/images/generations
    //   { "model": "doubao-seedream-5-0-260128", "prompt": "...", "response_format": "b64_json" }
    // 是 OpenAI Images API 兼容变体，path 在 /doubao/ 子路径下，
    // model id 必须带 doubao- 前缀（302 网页 URL slug "seedream-5-0-260128" 不是 model id）。
    baseUrl: 'https://api.302.ai/doubao',
    suggestedModel: 'doubao-seedream-5-0-260128',
    apiFlavor: 'openai-compatible',
    notes:
      '约 0.035 PTC/张。验证 2026-05。注意：locked character 参考图当前不通——doubao 期望参考图是 URL 不是 base64',
  },
  {
    id: '302-image-nano-banana',
    label: '302.AI · Nano Banana (Gemini 文生图)',
    kind: 'text2image',
    // 协议：POST https://api.302.ai/v1beta/models/gemini-2.5-flash-image:generateContent
    // 302 网页同时列出 "gemini-2.5-flash-image-v1beta（官方格式）"——那是产品命名，
    // 不是 model id 本身；真正请求里 model 段还是不带后缀的 gemini-2.5-flash-image。
    baseUrl: 'https://api.302.ai',
    suggestedModel: 'gemini-2.5-flash-image',
    apiFlavor: 'gemini',
    notes:
      '⚠️ base URL 不带 /v1（Gemini 协议自己的路径就是 /v1beta/models/{model}:generateContent）。约 0.2-0.5 PTC/张，比 Seedream 贵但指令跟随更精准。验证 2026-05',
  },

  // === 图生视频 ===
  {
    id: '302-i2v-wan-flash',
    label: '⭐ 302.AI · 通义万相 Wan2.2 Flash (最便宜 · 阿里)',
    kind: 'image2video',
    // 阿里 DashScope 协议（异步任务）：
    //   POST /aliyun/api/v1/services/aigc/video-generation/video-synthesis
    //   header: X-DashScope-Async: enable
    //   body: { model, input:{prompt, img_url}, parameters:{resolution, duration, prompt_extend, watermark} }
    //   resp: { output: { task_id, task_status: "PENDING" } }
    //   GET /aliyun/api/v1/tasks/{task_id} 轮询
    // 起始帧支持 data:image/...;base64 dataURL，dramai 直接发本地 Blob。
    // **务必走 .cn 中转**——直连 .ai 域名在跨子路径协议上 CORS 不稳，曾扣冤枉钱。
    baseUrl: 'https://api.302ai.cn',
    suggestedModel: 'wan2.2-i2v-flash',
    apiFlavor: 'aliyun',
    notes:
      '🟢 性价比之王：5 秒 720P 仅约 0.2 PTC，6 个分镜 ≈ 1.2 PTC（¥8 左右）；duration 固定 5 秒。验证 2026-05',
  },
]

export const PROVIDER_KIND_LABEL: Record<ProviderKind, string> = {
  llm: 'LLM 文本生成',
  text2image: '文生图',
  image2video: '图生视频',
  imageEdit: '图片编辑',
}
