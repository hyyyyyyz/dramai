import {
  asRecord,
  base64ToBytes,
  errorMessageOf,
  joinUrl,
  jsonHeaders,
  jsonPost,
  splitDataUrl,
  str,
  toDataUrl,
} from '../http.ts'
import type { ImageGenInput, MediaProtocol, OutputRef } from '../types.ts'

/**
 * OpenAI 兼容 `POST {baseUrl}/images/generations`。
 *
 * 以 OpenAI Images API 为最小公约数，容忍聚合平台的扩展：参考图以 data URL 同时填
 * `image` / `image_url` / `reference_images`（不支持的服务商会忽略）。默认要 b64_json，
 * 避免再去取有时效的图片 URL。
 */
export const openaiImages: MediaProtocol<ImageGenInput> = {
  id: 'openai-images',
  media: 'image',

  buildGenerateRequest(auth, input) {
    const body: Record<string, unknown> = {
      model: auth.model,
      prompt: input.prompt,
      n: input.n ?? 1,
      response_format: 'b64_json',
    }
    if (input.size) body.size = `${input.size.width}x${input.size.height}`
    if (input.quality) body.quality = input.quality
    if (input.negativePrompt) body.negative_prompt = input.negativePrompt
    if (input.references && input.references.length > 0) {
      const urls = input.references.map(toDataUrl)
      body.image = urls[0]
      body.image_url = urls[0]
      body.reference_images = urls
    }
    return jsonPost(joinUrl(auth.baseUrl, '/images/generations'), body, jsonHeaders(auth.apiKey))
  },

  parseGenerateResponse(raw) {
    const json = asRecord(raw.json)
    if (!json) return { status: 'failed', message: 'Image API 返回的不是 JSON' }
    const data = json.data
    if (!Array.isArray(data) || data.length === 0) {
      return { status: 'failed', message: errorMessageOf(json, 'Image API 没返回任何图片') }
    }
    const outputs: OutputRef[] = []
    for (const entry of data) {
      const e = asRecord(entry)
      if (!e) continue
      const b64 = str(e.b64_json)
      const url = str(e.url)
      if (b64) {
        const { mime, base64 } = splitDataUrl(b64)
        outputs.push({ kind: 'bytes', bytes: base64ToBytes(base64), mime })
      } else if (url) {
        outputs.push({ kind: 'url', url })
      }
    }
    if (outputs.length === 0) {
      return { status: 'failed', message: 'Image API 返回结构无法识别：缺少 url 与 b64_json' }
    }
    return { status: 'sync', outputs }
  },
}
