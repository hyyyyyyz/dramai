import type { Provider } from '@/types/domain'
import type { I2VClient, I2VRequest, I2VStatus, I2VTaskHandle } from '@/core/video/types'

/**
 * 通用 OpenAI 兼容图生视频客户端（best-effort）。
 *
 * 协议：（业界没有完全统一的标准，这里采用最常见的形态）
 *   POST {baseUrl}/videos/generations
 *     body: { model, prompt, image (base64 dataURL), duration?, aspect_ratio? }
 *     resp: { id, status: "queued"|"processing"|"completed"|"failed", ... }
 *   GET  {baseUrl}/videos/generations/{id}
 *     resp: { id, status, output?: { url } 或 video?: { url } 或 data: [{ url }] }
 *
 * 如果你的 provider 用的不是这个协议（多见于 Kling / Runway 自家直连），
 * 在 Settings 里把 API Flavor 切成对应值。
 */
export function createOpenAICompatibleVideoClient(
  provider: Pick<Provider, 'baseUrl' | 'apiKey' | 'model'>,
): I2VClient {
  const root = provider.baseUrl.replace(/\/+$/, '')

  return {
    async submit(req: I2VRequest): Promise<I2VTaskHandle> {
      const imageDataUrl = await blobToDataURL(req.imageBlob)
      const promptParts = [req.prompt, req.cameraInstruction].filter(Boolean).join('. ')
      const body: Record<string, unknown> = {
        model: req.model || provider.model,
        prompt: promptParts,
        image: imageDataUrl,
        image_url: imageDataUrl,
      }
      if (req.durationSec) body.duration = req.durationSec
      if (req.aspectRatio) body.aspect_ratio = req.aspectRatio

      const res = await fetch(`${root}/videos/generations`, {
        method: 'POST',
        headers: jsonHeaders(provider.apiKey),
        body: JSON.stringify(body),
        signal: req.signal,
      })
      if (!res.ok) {
        throw new Error(`Video submit HTTP ${res.status}: ${(await safeText(res)).slice(0, 280)}`)
      }
      const json = (await res.json()) as Record<string, unknown>
      const taskId = pickTaskId(json)
      if (!taskId) throw new Error('Video submit 响应里没找到任务 id')
      return { taskId, apiFlavor: 'openai-compatible' }
    },

    async poll(handle: I2VTaskHandle, signal?: AbortSignal): Promise<I2VStatus> {
      const res = await fetch(`${root}/videos/generations/${encodeURIComponent(handle.taskId)}`, {
        headers: jsonHeaders(provider.apiKey),
        signal,
      })
      if (!res.ok) {
        return {
          kind: 'failed',
          message: `Video poll HTTP ${res.status}: ${(await safeText(res)).slice(0, 200)}`,
        }
      }
      const json = (await res.json()) as Record<string, unknown>
      const status = String((json.status ?? json.state ?? '') as string).toLowerCase()

      if (
        status === 'completed' ||
        status === 'succeeded' ||
        status === 'success' ||
        status === 'done'
      ) {
        const url = pickVideoUrl(json)
        if (!url) return { kind: 'failed', message: 'Video poll: 任务成功但缺少 url' }
        return { kind: 'succeeded', videoUrl: url }
      }
      if (status === 'failed' || status === 'error') {
        return { kind: 'failed', message: pickErrorMessage(json) }
      }
      if (status === 'processing' || status === 'running' || status === 'in_progress') {
        return { kind: 'processing' }
      }
      return { kind: 'queued' }
    },
  }
}

function pickTaskId(json: Record<string, unknown>): string | undefined {
  const candidates = [
    json.id,
    json.task_id,
    json.request_id,
    (json.data as Record<string, unknown> | undefined)?.id,
    (json.data as Record<string, unknown> | undefined)?.task_id,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c
  }
  return undefined
}

function pickVideoUrl(json: Record<string, unknown>): string | undefined {
  const direct = json.url ?? json.video_url
  if (typeof direct === 'string') return direct

  const output = json.output as Record<string, unknown> | undefined
  if (typeof output?.url === 'string') return output.url
  if (Array.isArray(output) && typeof (output[0] as { url?: unknown })?.url === 'string') {
    return (output[0] as { url: string }).url
  }

  const video = json.video as Record<string, unknown> | undefined
  if (typeof video?.url === 'string') return video.url

  const data = json.data as unknown
  if (Array.isArray(data)) {
    const first = data[0] as { url?: unknown } | undefined
    if (typeof first?.url === 'string') return first.url
  } else if (data && typeof data === 'object') {
    const url = (data as { url?: unknown }).url
    if (typeof url === 'string') return url
  }

  return undefined
}

function pickErrorMessage(json: Record<string, unknown>): string {
  const direct = json.error ?? json.message
  if (typeof direct === 'string') return direct
  if (direct && typeof direct === 'object') {
    const e = direct as { message?: unknown }
    if (typeof e.message === 'string') return e.message
  }
  return '视频任务失败'
}

function jsonHeaders(apiKey?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) h.Authorization = `Bearer ${apiKey}`
  return h
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsDataURL(blob)
  })
}
