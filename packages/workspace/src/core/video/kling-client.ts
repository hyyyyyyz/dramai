import type { Provider } from '@/types/domain'
import type { I2VClient, I2VRequest, I2VStatus, I2VTaskHandle } from '@/core/video/types'

/**
 * Kling 图生视频客户端。
 *
 * 公开协议（基于 https://docs.qingque.cn/d/home/eZQDB6_owvWGTNSJ-2QWUfBmO 等公开文档）：
 *   POST {baseUrl}/v1/videos/image2video
 *     body: { model_name, image (base64), prompt, duration: "5"|"10",
 *             cfg_scale, mode, camera_control? }
 *     resp: { code, request_id, data: { task_id, task_status: "submitted" } }
 *   GET  {baseUrl}/v1/videos/image2video/{task_id}
 *     resp: { code, data: { task_status, task_status_msg?,
 *                            task_result?: { videos: [{ url, duration }] } } }
 *
 * 用户在 dramai 里把 baseUrl 配成 302.AI 的 Kling 透传地址，或者 Kling 官方
 * 域名（视他们的端点而定）。客户端只关心协议形状。
 */
export function createKlingClient(
  provider: Pick<Provider, 'baseUrl' | 'apiKey' | 'model'>,
): I2VClient {
  const root = provider.baseUrl.replace(/\/+$/, '')

  return {
    async submit(req: I2VRequest): Promise<I2VTaskHandle> {
      const imageBase64 = await blobToPlainBase64(req.imageBlob)
      const promptParts = [req.prompt, req.cameraInstruction].filter(Boolean).join('. ')
      const body: Record<string, unknown> = {
        model_name: req.model || provider.model,
        image: imageBase64,
        prompt: promptParts,
        duration: String(req.durationSec ?? 5),
      }
      if (req.aspectRatio) body.aspect_ratio = req.aspectRatio

      const res = await fetch(`${root}/v1/videos/image2video`, {
        method: 'POST',
        headers: jsonHeaders(provider.apiKey),
        body: JSON.stringify(body),
        signal: req.signal,
      })
      if (!res.ok) {
        throw new Error(`Kling submit HTTP ${res.status}: ${(await safeText(res)).slice(0, 280)}`)
      }
      const json = (await res.json()) as {
        data?: { task_id?: string }
        task_id?: string
      }
      const taskId = json.data?.task_id ?? json.task_id
      if (!taskId) {
        throw new Error('Kling submit 响应里没找到 task_id')
      }
      return { taskId, apiFlavor: 'kling' }
    },

    async poll(handle: I2VTaskHandle, signal?: AbortSignal): Promise<I2VStatus> {
      const res = await fetch(
        `${root}/v1/videos/image2video/${encodeURIComponent(handle.taskId)}`,
        { headers: jsonHeaders(provider.apiKey), signal },
      )
      if (!res.ok) {
        return {
          kind: 'failed',
          message: `Kling poll HTTP ${res.status}: ${(await safeText(res)).slice(0, 200)}`,
        }
      }
      const json = (await res.json()) as {
        data?: {
          task_status?: string
          task_status_msg?: string
          task_result?: { videos?: Array<{ url?: string; duration?: number | string }> }
        }
      }
      const status = json.data?.task_status?.toLowerCase() ?? 'unknown'
      if (status === 'succeed' || status === 'succeeded' || status === 'success') {
        const v = json.data?.task_result?.videos?.[0]
        if (!v?.url) return { kind: 'failed', message: 'Kling: 任务成功但缺少 video.url' }
        const dur =
          typeof v.duration === 'number'
            ? v.duration
            : typeof v.duration === 'string'
              ? Number(v.duration)
              : undefined
        return { kind: 'succeeded', videoUrl: v.url, durationSec: dur }
      }
      if (status === 'failed' || status === 'fail' || status === 'error') {
        return {
          kind: 'failed',
          message: json.data?.task_status_msg ?? 'Kling 任务失败',
        }
      }
      if (status === 'processing' || status === 'running') {
        return { kind: 'processing', message: json.data?.task_status_msg }
      }
      // submitted / queued / unknown：都按 queued 处理
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

function blobToPlainBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // 去掉 data:...;base64, 前缀
      const idx = result.indexOf(',')
      resolve(idx >= 0 ? result.slice(idx + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsDataURL(blob)
  })
}
