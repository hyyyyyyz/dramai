import type { Provider } from '@/types/domain'
import type { T2IGeneratedImage, T2IRequest, T2IResult } from '@/core/image/types'
import { ImageRequestError } from '@/core/image/client'

/**
 * Google Gemini 原生 generateContent 协议下的文生图 / 图生图客户端。
 *
 * 协议：
 *   POST {baseUrl}/v1beta/models/{model}:generateContent
 *   header: x-goog-api-key (Gemini 官方) 或 Authorization: Bearer (302 / 聚合平台)
 *   body:
 *     {
 *       "contents": [{
 *         "parts": [
 *           { "text": "<prompt>" },
 *           { "inline_data": { "mime_type": "image/png", "data": "<base64>" } }
 *           // ↑ 参考图，可选；可以多张
 *         ]
 *       }],
 *       "generationConfig": { "responseModalities": ["IMAGE"] }   // 让模型返回图片
 *     }
 *   response:
 *     {
 *       "candidates": [{
 *         "content": {
 *           "parts": [
 *             { "inline_data": { "mime_type": "image/png", "data": "<base64>" } },
 *             { "text": "...optional caption..." }
 *           ]
 *         }
 *       }]
 *     }
 *
 * 适用：Google AI Studio 直连 / Vertex AI / 302.AI 透传 / 部分国内聚合平台。
 *
 * 特别提示：
 * - 302.AI 上 base URL 应配为 `https://api.302.ai`（**不要带 /v1**），因为
 *   Gemini 协议自己的路径就是 `/v1beta/models/{model}:generateContent`。
 * - 302 同时提供 `Authorization: Bearer ...` 和 `x-goog-api-key`，我们两个都发，
 *   覆盖更多兼容场景。
 */
export function createGeminiImageClient(provider: Pick<Provider, 'baseUrl' | 'apiKey' | 'model'>) {
  const root = provider.baseUrl.replace(/\/+$/, '')

  return {
    async generate(req: T2IRequest): Promise<T2IResult> {
      const modelName = req.model || provider.model
      if (!modelName) {
        throw new ImageRequestError('Gemini Image: 没填 model 名（如 gemini-2.5-flash-image）')
      }
      const url = `${root}/v1beta/models/${encodeURIComponent(modelName)}:generateContent`

      const parts: Array<Record<string, unknown>> = [{ text: req.prompt }]
      if (req.referenceImages && req.referenceImages.length > 0) {
        for (const blob of req.referenceImages) {
          const data = await blobToPlainBase64(blob)
          parts.push({
            inline_data: {
              mime_type: blob.type || 'image/png',
              data,
            },
          })
        }
      }

      const body: Record<string, unknown> = {
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['IMAGE'],
        },
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (provider.apiKey) {
        headers.Authorization = `Bearer ${provider.apiKey}`
        headers['x-goog-api-key'] = provider.apiKey
      }

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: req.signal,
      })

      if (!res.ok) {
        let detail = ''
        try {
          detail = (await res.text()).slice(0, 280)
        } catch {
          // ignore
        }
        throw new ImageRequestError(
          `Gemini Image API HTTP ${res.status}${detail ? ` · ${detail}` : ''}`,
          res.status,
          detail,
        )
      }

      const json = (await res.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              inline_data?: { mime_type?: string; data?: string }
              inlineData?: { mimeType?: string; data?: string } // camelCase 兼容
            }>
          }
        }>
      }

      const images: T2IGeneratedImage[] = []
      for (const c of json.candidates ?? []) {
        for (const p of c.content?.parts ?? []) {
          // 同时容忍 snake_case 与 camelCase
          const inline =
            p.inline_data ?? (p.inlineData as { mime_type?: string; data?: string } | undefined)
          if (!inline?.data) continue
          const mime =
            inline.mime_type ??
            (p.inlineData as { mimeType?: string } | undefined)?.mimeType ??
            'image/png'
          images.push(decodeBase64ToImage(inline.data, mime))
        }
      }
      if (images.length === 0) {
        throw new ImageRequestError(
          'Gemini Image: candidates 里没找到 inline_data（模型可能没启用 IMAGE 输出）',
        )
      }
      return { images, raw: json }
    },
  }
}

function blobToPlainBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const idx = result.indexOf(',')
      resolve(idx >= 0 ? result.slice(idx + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsDataURL(blob)
  })
}

function decodeBase64ToImage(b64: string, mime: string): T2IGeneratedImage {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return {
    blob: new Blob([bytes], { type: mime || 'image/png' }),
    mimeType: mime || 'image/png',
  }
}
