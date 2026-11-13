import { ProviderError } from './errors.ts'
import { sendRequest } from './executor.ts'
import { modelListRequest } from './model-list.ts'
import { isGoogleHost } from './protocols/gemini-image.ts'
import type { ExecutorDeps } from './executor.ts'
import { asRecord, authHeaders, joinUrl } from './http.ts'
import type { ProviderConfig } from './types.ts'

/**
 * 测试连接的结果分三种：成功 / 失败 / 无法验证。
 * "无法验证"表示这个协议没有廉价的只读探测端点（例如 Kling、DashScope、Seedance 的任务端点），
 * 不是失败——需要真实生成一次才能知道。
 */
export type TestConnectionResult =
  | { outcome: 'ok'; modelCount?: number; detectedModels?: string[]; modelListed?: boolean }
  | { outcome: 'failed'; error: string; status?: number; code?: string }
  | { outcome: 'unverifiable'; reason: string }

export async function testProvider(
  config: Pick<ProviderConfig, 'baseUrl' | 'protocol' | 'model'>,
  apiKey: string | undefined,
  deps: ExecutorDeps & { signal?: AbortSignal } = {},
): Promise<TestConnectionResult> {
  if (!config.baseUrl.trim())
    return { outcome: 'failed', code: 'BASE_URL_INVALID', error: 'Base URL 不能为空' }

  switch (config.protocol) {
    case 'aliyun-video':
    case 'volcengine-video':
    case 'kling-video':
    case 'generic-video':
    case 'kling-image':
    case 'dashscope-image':
    case 'volcengine-images':
    case 'siliconflow-images':
      return {
        outcome: 'unverifiable',
        reason: '该协议没有标准的模型列表端点，无法在测试连接里验证；请直接生成一次来实测。',
      }
    case 'gemini-image': {
      const headers: Record<string, string> = {}
      if (apiKey) {
        // 官方地址只认 x-goog-api-key（Bearer 的 API Key 会被拒）；聚合平台两个都发
        if (!isGoogleHost(config.baseUrl)) headers.Authorization = `Bearer ${apiKey}`
        headers['x-goog-api-key'] = apiKey
      }
      return probeList(
        config.protocol,
        joinUrl(config.baseUrl, '/v1beta/models'),
        headers,
        config.model,
        deps,
      )
    }
    case 'anthropic-messages':
    case 'gemini-chat': {
      // 各自的鉴权头和列表地址（见 model-list.ts）
      const req = modelListRequest(config.protocol, config.baseUrl, apiKey)!
      return probeList(config.protocol, req.url, req.headers, config.model, deps)
    }
    default:
      return probeList(
        config.protocol,
        joinUrl(config.baseUrl, '/models'),
        authHeaders(apiKey),
        config.model,
        deps,
      )
  }
}

async function probeList(
  protocol: string,
  url: string,
  headers: Record<string, string>,
  model: string,
  deps: ExecutorDeps & { signal?: AbortSignal },
): Promise<TestConnectionResult> {
  try {
    const raw = await sendRequest({ method: 'GET', url, headers }, deps, {
      signal: deps.signal,
      timeoutMs: 20_000,
    })
    if (raw.status < 200 || raw.status >= 300) {
      return {
        outcome: 'failed',
        status: raw.status,
        // 机器可读的码，规则和任务失败时一致（同一个错误在两处得到同一个码）：
        // Anthropic 取 `error.type`，Gemini 取 `error.status`，Responses 取 `error.code`，
        // 其余（含 openai-chat）是 `HTTP_<状态>`
        code: upstreamErrorCode(protocol, raw.json) ?? `HTTP_${raw.status}`,
        error: `HTTP ${raw.status}${raw.text ? ` · ${raw.text.slice(0, 180)}` : ''}`,
      }
    }
    const list = extractModelList(raw.json)
    if (list.length === 0 && raw.json === undefined) {
      return {
        outcome: 'failed',
        status: raw.status,
        code: 'UNREADABLE_RESPONSE',
        error: '响应不是 JSON',
      }
    }
    const short = (m: string) => m.replace(/^models\//, '')
    return {
      outcome: 'ok',
      modelCount: list.length,
      detectedModels: list.slice(0, 8),
      modelListed: list.length === 0 ? undefined : list.some((m) => short(m) === model),
    }
  } catch (err) {
    return {
      outcome: 'failed',
      error: err instanceof Error ? err.message : String(err),
      ...(err instanceof ProviderError ? { code: err.code } : {}),
    }
  }
}

/** 各协议在任务失败时从上游错误体里取的稳定码；取不到返回 undefined（调用方回落到 `HTTP_<状态>`）。 */
export function upstreamErrorCode(protocol: string, json: unknown): string | undefined {
  const err = asRecord(asRecord(json)?.error)
  const field =
    protocol === 'anthropic-messages'
      ? 'type'
      : protocol === 'gemini-chat'
        ? 'status'
        : protocol === 'openai-responses'
          ? 'code'
          : undefined
  const v = field ? err?.[field] : undefined
  return typeof v === 'string' && v ? v : undefined
}

function extractModelList(data: unknown): string[] {
  const obj = asRecord(data)
  if (!obj) return []
  const candidates = Array.isArray(obj.data)
    ? obj.data
    : Array.isArray(obj.models)
      ? obj.models
      : []
  const out: string[] = []
  for (const entry of candidates) {
    if (typeof entry === 'string') out.push(entry)
    else {
      const e = asRecord(entry)
      const id =
        typeof e?.id === 'string'
          ? e.id
          : typeof e?.slug === 'string'
            ? e.slug
            : typeof e?.name === 'string'
              ? e.name
              : ''
      if (id) out.push(id)
    }
  }
  return out
}
