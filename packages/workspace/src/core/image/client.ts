import type { Provider } from '@/types/domain'
import type { T2IGeneratedImage, T2IRequest, T2IResult } from '@/core/image/types'

export class ImageRequestError extends Error {
  readonly status?: number
  readonly body?: string
  constructor(message: string, status?: number, body?: string) {
    super(message)
    this.name = 'ImageRequestError'
    this.status = status
    this.body = body
  }
}

/**
 * 走 OpenAI 兼容 `/images/generations` 端点。
 * 返回的图片不管是 URL 还是 b64_json，都被规范化成 Blob。
 */
export async function generateImage(
  provider: Pick<Provider, 'baseUrl' | 'apiKey' | 'model'>,
  req: T2IRequest,
): Promise<T2IResult> {
  if (!provider.baseUrl) throw new ImageRequestError('Image provider 缺少 base URL')
  const url = `${provider.baseUrl.replace(/\/+$/, '')}/images/generations`

  const body: Record<string, unknown> = {
    model: req.model || provider.model,
    prompt: req.prompt,
    n: req.n ?? 1,
  }
  if (req.size) body.size = req.size
  if (req.quality) body.quality = req.quality
  if (req.negativePrompt) body.negative_prompt = req.negativePrompt
  // 默认请求 b64 返回，避免后续再去 fetch 图片 URL（许多供应商的图片 URL 短期有效）
  body.response_format = 'b64_json'

  if (req.referenceImages && req.referenceImages.length > 0) {
    const dataUrls = await Promise.all(req.referenceImages.map(blobToDataURL))
    // 同时填两个字段名，覆盖更多供应商；不支持的供应商会忽略
    body.image = dataUrls[0]
    body.image_url = dataUrls[0]
    body.reference_images = dataUrls
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: req.signal,
  })

  if (!res.ok) {
    const detail = await safeReadText(res)
    throw new ImageRequestError(
      `Image API HTTP ${res.status}${detail ? ` · ${detail}` : ''}`,
      res.status,
      detail,
    )
  }

  const json = (await res.json()) as Record<string, unknown>
  const data = (json.data as unknown[] | undefined) ?? []
  if (data.length === 0) {
    throw new ImageRequestError('Image API 没返回任何图片', res.status)
  }

  const images: T2IGeneratedImage[] = []
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as { url?: string; b64_json?: string }
    if (e.b64_json) {
      images.push(await base64ToBlob(e.b64_json))
    } else if (e.url) {
      images.push(await fetchUrlToBlob(e.url))
    }
  }
  if (images.length === 0) {
    throw new ImageRequestError('Image API 返回结构无法识别：缺少 url 与 b64_json')
  }

  return { images, raw: json }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 280)
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

async function base64ToBlob(b64: string): Promise<T2IGeneratedImage> {
  // 如果是 data:image/...;base64,... 形式先剥前缀
  const dataUrlMatch = /^data:([^;]+);base64,(.*)$/.exec(b64)
  const mime = dataUrlMatch?.[1] ?? 'image/png'
  const payload = dataUrlMatch?.[2] ?? b64
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return {
    blob: new Blob([bytes], { type: mime }),
    mimeType: mime,
  }
}

async function fetchUrlToBlob(url: string): Promise<T2IGeneratedImage> {
  // 注意：跨域时部分图片 host 可能 CORS 限制；常见聚合平台返回的 URL 通常是开放 CORS 的。
  const r = await fetch(url)
  if (!r.ok) {
    throw new ImageRequestError(`无法下载生成的图片：HTTP ${r.status}`)
  }
  const blob = await r.blob()
  return { blob, mimeType: blob.type || 'image/png' }
}
