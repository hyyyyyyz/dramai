import type { Provider } from '@/types/domain'
import type { T2IRequest, T2IResult } from '@/core/image/types'
import { generateImage as generateImageOpenAICompat } from '@/core/image/client'
import { createGeminiImageClient } from '@/core/image/gemini-client'

/**
 * 根据 Provider.apiFlavor 选择文生图客户端。
 *
 *  - 'gemini'                       → Google Gemini 原生 generateContent（302 上的 Nano Banana 走这条）
 *  - 'openai-compatible' / 缺省     → POST /v1/images/generations
 *  - 'kling' / 'runway'             → 不适用于文生图（这俩主要是 image2video），按 OpenAI 兼容兜底
 */
export async function generateImage(provider: Provider, req: T2IRequest): Promise<T2IResult> {
  const flavor = provider.apiFlavor ?? 'openai-compatible'
  if (flavor === 'gemini') {
    const client = createGeminiImageClient(provider)
    return client.generate(req)
  }
  return generateImageOpenAICompat(provider, req)
}
