import { joinUrl, jsonHeaders, jsonPost, toDataUrl } from '../http.ts'
import type { ImageGenInput, MediaProtocol } from '../types.ts'
import { parseImagesData } from './openai-images.ts'

/**
 * 火山方舟 Seedream 直连：`POST {baseUrl}/images/generations`，baseUrl 缺省
 * `https://ark.cn-beijing.volces.com/api/v3`，`Authorization: Bearer`（长效 API Key）。
 * 依据：官方图片生成 API（docs 82379/1541523）和 Seedream 教程（82379/1824121），2026-11 核对。
 *
 * 和 302.AI 的 `/doubao` 子路径（`openai-images` 协议，实测过）**不是一回事**：
 * - 参考图只用 `image` 字段，值是 data URI（`data:image/<格式>;base64,…`）字符串（一张）或数组（多张）；
 *   官方接受 URL 和 data URI。302 路径期望的是 URL，所以那边参考图当前不通；直连没有这个限制。
 * - **不支持 `n`**（一次一张图；组图靠 `sequential_image_generation`，这里不用），不发 `quality` / `negative_prompt`；
 * - `watermark` 官方默认 **true**（右下角"AI 生成"），必须显式关；
 * - `response_format: b64_json`，不去取 24 小时就过期的 URL；
 * - `size`：`WxH`（总像素有下限：5.5 / 5.0 pro / flash 92.16 万，5.0 lite / 4.5 368.64 万；宽高比 [1/16, 16]），
 *   低于下限就按比例放大。`data[].error` 是这一张失败。
 */

/** 每个型号的最小总像素（官方教程页）。 */
export function seedreamMinPixels(model: string): number {
  if (/seedream-5-0-(?!pro|flash)\d|seedream-4-5/.test(model)) return 3_686_400
  return 921_600
}

export const volcengineImages: MediaProtocol<ImageGenInput> = {
  id: 'volcengine-images',
  media: 'image',

  buildGenerateRequest(auth, input) {
    const body: Record<string, unknown> = {
      model: auth.model,
      prompt: input.prompt,
      response_format: 'b64_json',
      watermark: false,
    }
    if (input.size) {
      let { width, height } = input.size
      const min = seedreamMinPixels(auth.model)
      if (width * height < min) {
        const k = Math.sqrt(min / (width * height))
        width = Math.ceil((width * k) / 2) * 2
        height = Math.ceil((height * k) / 2) * 2
      }
      body.size = `${width}x${height}`
    }
    const refs = input.references ?? []
    if (refs.length === 1) body.image = toDataUrl(refs[0]!)
    else if (refs.length > 1) body.image = refs.map(toDataUrl)
    return jsonPost(joinUrl(auth.baseUrl, '/images/generations'), body, jsonHeaders(auth.apiKey))
  },

  parseGenerateResponse: parseImagesData,
}
