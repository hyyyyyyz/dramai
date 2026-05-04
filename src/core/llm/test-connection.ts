import type { Provider } from '@/types/domain'

export interface TestConnectionResult {
  ok: boolean
  modelCount?: number
  detectedModels?: string[]
  error?: string
  status?: number
}

/**
 * 通过 GET `${baseUrl}/models` 验证 OpenAI 兼容 endpoint。
 *
 * 大多数兼容 OpenAI 协议的服务都支持这个端点，并返回 `{ data: [{id, ...}] }`
 * 或 `{ models: [...] }` 形态。
 */
export async function testProvider(
  provider: Pick<Provider, 'baseUrl' | 'apiKey'>,
  options: { signal?: AbortSignal } = {},
): Promise<TestConnectionResult> {
  if (!provider.baseUrl) {
    return { ok: false, error: 'Base URL 不能为空' }
  }
  const url = `${provider.baseUrl.replace(/\/+$/, '')}/models`

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
      signal: options.signal,
    })

    if (!res.ok) {
      let detail = ''
      try {
        detail = (await res.text()).slice(0, 180)
      } catch {
        // ignore
      }
      return {
        ok: false,
        status: res.status,
        error: `HTTP ${res.status}${detail ? ` · ${detail}` : ''}`,
      }
    }

    const data = (await res.json()) as unknown
    const list = extractModelList(data)
    return {
      ok: true,
      modelCount: list.length,
      detectedModels: list.slice(0, 8),
    }
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? (err.name === 'AbortError' ? '已取消' : err.message) : String(err),
    }
  }
}

function extractModelList(data: unknown): string[] {
  if (!data || typeof data !== 'object') return []
  const obj = data as Record<string, unknown>
  const candidates: unknown[] = []
  if (Array.isArray(obj.data)) candidates.push(...(obj.data as unknown[]))
  else if (Array.isArray(obj.models)) candidates.push(...(obj.models as unknown[]))
  return candidates
    .map((entry) => {
      if (typeof entry === 'string') return entry
      if (entry && typeof entry === 'object') {
        const e = entry as Record<string, unknown>
        return typeof e.id === 'string' ? e.id : typeof e.name === 'string' ? e.name : ''
      }
      return ''
    })
    .filter(Boolean)
}
