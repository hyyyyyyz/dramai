import {
  asRecord,
  jsonObjectOrFail,
  errorMessageOf,
  joinUrl,
  jsonHeaders,
  jsonPost,
  str,
  toDataUrl,
} from '../http.ts'
import type { ImageGenInput, MediaProtocol, OutputRef } from '../types.ts'

/**
 * 硅基流动图像：`POST {baseUrl}/images/generations`，`Authorization: Bearer`，
 * baseUrl `https://api.siliconflow.cn/v1`（国内）/ `https://api.siliconflow.com/v1`（国际）。
 * 依据：官方 API 参考 docs.siliconflow.com/en/api-reference/images/images-generations（国际站页面，2026-11 核对；
 * 国内站页面当天读不到）。形态像 OpenAI，但有四处不同，所以单独一个协议：
 * - 响应是 `images:[{url}]`（不是 `data[]`），还有 `seed`、`timings`；**URL 一小时有效**（成功后立即下载）；
 * - 尺寸字段是 `image_size`（`宽x高`）；Qwen/Qwen-Image 官方推荐固定几档，按画幅取最近的一档；
 * - 参考图是 data URL，字段名因型号而异：Qwen-Image-Edit 和 FLUX.1-Kontext-dev 用 `image`，
 *   FLUX.1-Kontext-max/pro 用 `input_image`；**只有一张**，多参考图基本不支持；
 * - 只有部分型号收 `negative_prompt`（Qwen-Image、Z-Image）、`batch_size`（Qwen-Image，1~4）；Qwen-Image-Edit 不收 `image_size`。
 * 错误：400 `{code,message,data}`，401/404/504 是纯文本，429/503 是对象。
 */

/** Qwen/Qwen-Image 官方推荐的尺寸（按画幅）。 */
export const SILICONFLOW_QWEN_SIZES: Record<string, string> = {
  '1:1': '1328x1328',
  '16:9': '1664x928',
  '9:16': '928x1664',
}

const isQwenImage = (m: string) => /^Qwen\/Qwen-Image$/i.test(m)
const isQwenEdit = (m: string) => /^Qwen\/Qwen-Image-Edit/i.test(m)

/** 这个型号的参考图字段名（没有 = 不收参考图）。 */
export function siliconflowRefField(model: string): 'image' | 'input_image' | undefined {
  if (isQwenEdit(model) || /FLUX\.1-Kontext-dev/i.test(model)) return 'image'
  if (/FLUX\.1-Kontext-(max|pro)/i.test(model)) return 'input_image'
  return undefined
}

export const siliconflowImages: MediaProtocol<ImageGenInput> = {
  id: 'siliconflow-images',
  media: 'image',

  buildGenerateRequest(auth, input) {
    const body: Record<string, unknown> = { model: auth.model, prompt: input.prompt }
    if (!isQwenEdit(auth.model)) {
      if (
        isQwenImage(auth.model) &&
        input.aspectRatio &&
        SILICONFLOW_QWEN_SIZES[input.aspectRatio]
      ) {
        body.image_size = SILICONFLOW_QWEN_SIZES[input.aspectRatio]
      } else if (input.size) {
        body.image_size = `${input.size.width}x${input.size.height}`
      }
    }
    if (input.negativePrompt && (isQwenImage(auth.model) || /Z-Image/i.test(auth.model))) {
      body.negative_prompt = input.negativePrompt
    }
    if (isQwenImage(auth.model) && input.n && input.n > 1) body.batch_size = Math.min(input.n, 4)
    const field = siliconflowRefField(auth.model)
    const ref = input.references?.[0]
    if (field && ref) body[field] = toDataUrl(ref)
    return jsonPost(joinUrl(auth.baseUrl, '/images/generations'), body, jsonHeaders(auth.apiKey))
  },

  parseGenerateResponse(raw) {
    const parsed = jsonObjectOrFail(raw, '硅基流动')
    if (!parsed.ok) return parsed.result
    const json = parsed.json
    const images = json.images
    const outputs: OutputRef[] = []
    if (Array.isArray(images)) {
      for (const i of images) {
        const url = str(asRecord(i)?.url)
        if (url) outputs.push({ kind: 'url', url })
      }
    }
    if (outputs.length > 0) return { status: 'sync', outputs }
    return { status: 'failed', message: errorMessageOf(json, '硅基流动没有返回图片') }
  },
}
