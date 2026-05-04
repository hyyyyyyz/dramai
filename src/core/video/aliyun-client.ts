import type { Provider } from '@/types/domain'
import type { I2VClient, I2VRequest, I2VStatus, I2VTaskHandle } from '@/core/video/types'

const ALLOWED_DURATIONS = [3, 4, 5, 10, 15] as const

/**
 * 阿里云通义万相（DashScope）图生视频客户端。
 *
 * 协议（来自 302.AI 上 wan2.7-i2v 产品页 OpenAPI Spec，2026-05 验证）：
 *
 *   POST {baseUrl}/aliyun/api/v1/services/aigc/video-generation/video-synthesis
 *     header: Authorization: Bearer ...
 *             X-DashScope-Async: enable    （阿里官方协议要求异步任务带这个头）
 *     body: {
 *       model: "wan2.2-i2v-flash" | "wan2.2-i2v-plus" | "wan2.7-i2v" | ...,
 *       input: {
 *         prompt: "<prompt + camera instruction>",
 *         img_url: "data:image/png;base64,..." | "https://...",
 *         negative_prompt?: "...",
 *         audio_url?: "..."
 *       },
 *       parameters: {
 *         resolution: "480P" | "720P" | "1080P",
 *         duration: 3 | 4 | 5 | 10 | 15,
 *         prompt_extend: true,
 *         watermark: false
 *       }
 *     }
 *     resp: {
 *       request_id, output: { task_id, task_status: "PENDING" }
 *     }
 *
 *   GET  {baseUrl}/aliyun/api/v1/tasks/{task_id}
 *     resp: {
 *       request_id,
 *       output: {
 *         task_id, task_status: "PENDING"|"RUNNING"|"SUCCEEDED"|"FAILED"|"CANCELED"|"UNKNOWN",
 *         video_url?: "https://...",   // SUCCEEDED 时
 *         message?, code?
 *       }
 *     }
 *
 * Base URL 应该指向 302 root：`https://api.302ai.cn`（默认走 .cn 中转避开 CORS 坑）。
 *
 * Spec 明确支持 img_url 用 base64 dataURL（"输入方式 2"），dramai 直接发本地 Blob 转 dataURL，无需图床。
 *
 * **价格（2026-05）**：
 *   wan2.2-i2v-flash    480P 0.02 PTC/秒  720P 0.04 PTC/秒  ← 性价比之王
 *   wan2.2-i2v-plus     480P 0.03 PTC/秒  1080P 0.15 PTC/秒
 *   wan2.5-i2v-preview  480P 0.05 PTC/秒  720P 0.10 PTC/秒  1080P 0.16 PTC/秒（支持音频）
 *   wan2.7-i2v          720P 0.10 PTC/秒  1080P 0.15 PTC/秒（最新）
 */
export function createAliyunClient(
  provider: Pick<Provider, 'baseUrl' | 'apiKey' | 'model'>,
): I2VClient {
  const root = provider.baseUrl.replace(/\/+$/, '')

  return {
    async submit(req: I2VRequest): Promise<I2VTaskHandle> {
      const promptText = [req.prompt, req.cameraInstruction]
        .filter((s): s is string => Boolean(s && s.trim()))
        .join('. ')
      const imageDataUrl = await blobToDataURL(req.imageBlob)

      const duration = sanitizeDuration(req.durationSec ?? 5)
      const body: Record<string, unknown> = {
        model: req.model || provider.model,
        input: {
          prompt: promptText,
          img_url: imageDataUrl,
        },
        parameters: {
          resolution: '720P',
          duration,
          prompt_extend: true,
          watermark: false,
        },
      }

      let res: Response
      try {
        res = await fetch(`${root}/aliyun/api/v1/services/aigc/video-generation/video-synthesis`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
            'X-DashScope-Async': 'enable',
          },
          body: JSON.stringify(body),
          signal: req.signal,
        })
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw err
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(
          `${msg} · 可能是 CORS 拦截：请求大概率已送达 302 并扣 token，但浏览器拿不到响应。建议：(1) base URL 切到 https://api.302ai.cn 国内中转；(2) 去 302 后台对账，必要时申诉退款；(3) 暂停继续点击，避免再次扣费`,
          { cause: err },
        )
      }
      if (!res.ok) {
        throw new Error(`Aliyun submit HTTP ${res.status}: ${(await safeText(res)).slice(0, 280)}`)
      }
      const json = (await res.json()) as {
        output?: { task_id?: string; task_status?: string }
        request_id?: string
      }
      const taskId = json.output?.task_id
      if (!taskId) {
        throw new Error('Aliyun submit 响应里没找到 output.task_id')
      }
      return { taskId, apiFlavor: 'aliyun' }
    },

    async poll(handle: I2VTaskHandle, signal?: AbortSignal): Promise<I2VStatus> {
      const res = await fetch(`${root}/aliyun/api/v1/tasks/${encodeURIComponent(handle.taskId)}`, {
        headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
        signal,
      })
      if (!res.ok) {
        return {
          kind: 'failed',
          message: `Aliyun poll HTTP ${res.status}: ${(await safeText(res)).slice(0, 200)}`,
        }
      }
      const json = (await res.json()) as {
        output?: {
          task_status?: string
          video_url?: string
          message?: string
          code?: string
          results?: Array<{ url?: string; video_url?: string }>
        }
      }
      const status = (json.output?.task_status ?? '').toUpperCase()

      if (status === 'SUCCEEDED' || status === 'SUCCESS') {
        const url =
          json.output?.video_url ??
          json.output?.results?.[0]?.video_url ??
          json.output?.results?.[0]?.url
        if (!url) {
          return {
            kind: 'failed',
            message:
              'Aliyun: 任务成功但响应里没找到 video_url（output.video_url 与 output.results[].url 都没值）',
          }
        }
        return { kind: 'succeeded', videoUrl: url }
      }
      if (status === 'FAILED' || status === 'CANCELED') {
        return {
          kind: 'failed',
          message: json.output?.message ?? `任务${status.toLowerCase()}`,
        }
      }
      if (status === 'RUNNING') return { kind: 'processing' }
      // PENDING / UNKNOWN / 空都按 queued 处理
      return { kind: 'queued' }
    },
  }
}

function sanitizeDuration(d: number): number {
  // 找最近的合法值
  let best = ALLOWED_DURATIONS[0] as number
  let bestDiff = Math.abs(d - best)
  for (const v of ALLOWED_DURATIONS) {
    const diff = Math.abs(d - v)
    if (diff < bestDiff) {
      best = v
      bestDiff = diff
    }
  }
  return best
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
