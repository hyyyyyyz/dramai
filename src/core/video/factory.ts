import type { Provider } from '@/types/domain'
import type { I2VClient } from '@/core/video/types'
import { createKlingClient } from '@/core/video/kling-client'
import { createOpenAICompatibleVideoClient } from '@/core/video/openai-compat-client'
import { createVolcengineClient } from '@/core/video/volcengine-client'

/**
 * 根据 Provider.apiFlavor 选客户端。
 *  - 'kling'                     → Kling 原生协议
 *  - 'volcengine'                → 火山方舟（即梦 Seedance / Doubao 视频）
 *  - 'openai-compatible' / 缺省  → 通用兼容路径（POST /videos/generations）
 *
 * Runway 协议待 v0.5+ 接入。在那之前，Runway 用户可在 302.AI 这种聚合上
 * 走 OpenAI-compatible 透传。
 */
export function createVideoClient(provider: Provider): I2VClient {
  const flavor = provider.apiFlavor ?? 'openai-compatible'
  if (flavor === 'kling') return createKlingClient(provider)
  if (flavor === 'volcengine') return createVolcengineClient(provider)
  // 'runway' 暂时用通用客户端兜底（用户可改 baseUrl 走 302 透传）
  return createOpenAICompatibleVideoClient(provider)
}
