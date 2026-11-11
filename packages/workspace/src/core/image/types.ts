/**
 * 文生图 / 图生图协议。
 *
 * 我们以 OpenAI Images API 为最小公约数（POST /v1/images/generations，
 * 返回 { data: [{ url? | b64_json? }] }），同时容忍以下扩展：
 *   - 部分聚合平台用 `image` / `image_url` / `reference_images` 字段
 *     传"参考图"以做图生图；它们都会被以 base64 dataURL 形式发出去。
 *   - 部分平台返回 `data[0].b64_json`，部分返回 `data[0].url`。
 */

export interface T2IRequest {
  model: string
  prompt: string
  negativePrompt?: string
  /** 单次生成图片张数。默认 1。 */
  n?: number
  /** "1024x1024" | "1024x1792" | "1792x1024"...由模型自决。 */
  size?: string
  quality?: 'standard' | 'hd'
  /**
   * 参考图（角色锁定图、image edit、图生图等场景）。
   * 客户端会转 base64 dataURL 后塞到 `image` / `reference_images` 字段。
   * 不同模型支持程度不一，能用的会用，不能用的会被忽略。
   */
  referenceImages?: Blob[]
  signal?: AbortSignal
}

export interface T2IGeneratedImage {
  blob: Blob
  mimeType: string
  width?: number
  height?: number
}

export interface T2IResult {
  images: T2IGeneratedImage[]
  raw?: unknown
}
