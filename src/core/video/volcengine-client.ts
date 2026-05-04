import type { Provider } from '@/types/domain'
import type { I2VClient, I2VRequest, I2VStatus, I2VTaskHandle } from '@/core/video/types'

/**
 * 火山方舟（Volcengine）即梦 Seedance 系列图生视频客户端。
 *
 * 协议（来自 302.AI 上 Seedance 2.0 产品页 OpenAPI Spec，2026-05 验证）：
 *
 *   POST {baseUrl}/volcengine/api/v3/contents/generations/tasks
 *     body: {
 *       model: "doubao-seedance-2-0-fast-260128",
 *       content: [
 *         { type: "text", text: "<prompt + camera instruction>" },
 *         { type: "image_url", image_url: { url: "data:image/png;base64,..." } }
 *       ],
 *       ratio: "16:9" | "9:16" | "1:1" | "adaptive" | ...,
 *       duration: 5,            // [4, 15] 秒；-1 = 模型自选
 *       resolution: "720p",     // "480p" / "720p" / "1080p"
 *       generate_audio: false,  // 默认 true，但 dramai 暂时跳过音频
 *       watermark: false
 *     }
 *     resp: { id: "cgt-20260504..." }
 *
 *   GET  {baseUrl}/volcengine/api/v3/contents/generations/tasks/{id}
 *     resp: {
 *       id, model, status: "queued"|"running"|"succeeded"|"failed"|"expired",
 *       content?: { video_url: "https://..." },  // 成功时
 *       usage?: {...},
 *       error?: { code, message }
 *     }
 *
 * Base URL 应该指向 302 的 root：`https://api.302.ai`（**不带任何后缀**），
 * 这个 client 自己拼上 `/volcengine/api/v3/...` 路径。
 *
 * Spec 明确支持起始帧用 base64 dataURL（example 5），所以 dramai 不需要图床。
 */
export function createVolcengineClient(
  provider: Pick<Provider, 'baseUrl' | 'apiKey' | 'model'>,
): I2VClient {
  const root = provider.baseUrl.replace(/\/+$/, '')

  return {
    async submit(req: I2VRequest): Promise<I2VTaskHandle> {
      const promptText = [req.prompt, req.cameraInstruction]
        .filter((s): s is string => Boolean(s && s.trim()))
        .join('. ')

      const imageDataUrl = await blobToDataURL(req.imageBlob)

      const content: Array<Record<string, unknown>> = []
      if (promptText) content.push({ type: 'text', text: promptText })
      content.push({
        type: 'image_url',
        image_url: { url: imageDataUrl },
      })

      const body: Record<string, unknown> = {
        model: req.model || provider.model,
        content,
        ratio: req.aspectRatio ?? 'adaptive',
        duration: req.durationSec ?? 5,
        resolution: '720p',
        generate_audio: false,
        watermark: false,
      }

      const res = await fetch(`${root}/volcengine/api/v3/contents/generations/tasks`, {
        method: 'POST',
        headers: jsonHeaders(provider.apiKey),
        body: JSON.stringify(body),
        signal: req.signal,
      })
      if (!res.ok) {
        throw new Error(
          `Volcengine submit HTTP ${res.status}: ${(await safeText(res)).slice(0, 280)}`,
        )
      }
      const json = (await res.json()) as { id?: string }
      if (!json.id) {
        throw new Error('Volcengine submit 响应里没找到 task id')
      }
      return { taskId: json.id, apiFlavor: 'volcengine' }
    },

    async poll(handle: I2VTaskHandle, signal?: AbortSignal): Promise<I2VStatus> {
      const res = await fetch(
        `${root}/volcengine/api/v3/contents/generations/tasks/${encodeURIComponent(handle.taskId)}`,
        { headers: jsonHeaders(provider.apiKey), signal },
      )
      if (!res.ok) {
        return {
          kind: 'failed',
          message: `Volcengine poll HTTP ${res.status}: ${(await safeText(res)).slice(0, 200)}`,
        }
      }
      const json = (await res.json()) as {
        status?: string
        content?: { video_url?: string; videoUrl?: string }
        error?: { code?: string; message?: string }
      }
      const status = (json.status ?? '').toLowerCase()

      if (status === 'succeeded' || status === 'success') {
        const url = json.content?.video_url ?? json.content?.videoUrl
        if (!url) {
          return {
            kind: 'failed',
            message: 'Volcengine: 任务成功但缺少 content.video_url',
          }
        }
        return { kind: 'succeeded', videoUrl: url }
      }
      if (status === 'failed' || status === 'error' || status === 'expired') {
        return {
          kind: 'failed',
          message: json.error?.message ?? `任务${status || '失败'}（火山方舟未提供详细错误）`,
        }
      }
      if (status === 'running') return { kind: 'processing' }
      // queued / 空 / 未知都按 queued 处理
      return { kind: 'queued' }
    },
  }
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
