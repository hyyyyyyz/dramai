import { anthropicHeaders, parseAnthropicModels } from './protocols/anthropic-messages.ts'
import { geminiHeaders, parseGeminiModels } from './protocols/gemini-chat.ts'
import { parseResponsesModels } from './protocols/openai-responses.ts'
import type { ListedModel } from './protocols/openai-responses.ts'
import { authHeaders, joinUrl } from './http.ts'
import type { ProtocolId } from './types.ts'

export interface ModelListRequest {
  url: string
  headers: Record<string, string>
  parse(json: unknown): ListedModel[]
}

/**
 * 各文本协议怎么取模型列表。没有列表接口的协议返回 undefined（调用方给 `MODEL_LIST_UNSUPPORTED`）。
 * - openai-chat / openai-responses：`GET {base}/models`（OpenAI 形态 `data[]`，账号登录形态 `models[]`）；
 * - anthropic-messages：`GET {base}/v1/models`（官方 Models API，`limit` 最大 1000）；
 * - gemini-chat：`GET {base}/v1beta/models`（`models[]`，只留能 generateContent 的；分页参数官方参考页没写）。
 * 图片 / 视频 / 语音协议没有统一的列表接口。
 */
export function modelListRequest(
  protocol: ProtocolId,
  baseUrl: string,
  bearer: string | undefined,
): ModelListRequest | undefined {
  switch (protocol) {
    case 'openai-chat':
    case 'openai-responses':
      return {
        url: joinUrl(baseUrl, '/models'),
        headers: authHeaders(bearer),
        parse: parseResponsesModels,
      }
    case 'anthropic-messages': {
      const { 'Content-Type': _ct, ...headers } = anthropicHeaders(bearer)
      void _ct
      return {
        url: `${joinUrl(baseUrl, '/v1/models')}?limit=1000`,
        headers,
        parse: parseAnthropicModels,
      }
    }
    case 'gemini-chat': {
      const { 'Content-Type': _ct, ...headers } = geminiHeaders(bearer)
      void _ct
      return { url: joinUrl(baseUrl, '/v1beta/models'), headers, parse: parseGeminiModels }
    }
    default:
      return undefined
  }
}
