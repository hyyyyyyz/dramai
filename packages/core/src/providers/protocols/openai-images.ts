import {
  asRecord,
  authHeaders,
  base64ToBytes,
  errorMessageOf,
  jsonObjectOrFail,
  joinUrl,
  jsonHeaders,
  jsonPost,
  splitDataUrl,
  str,
  toDataUrl,
} from '../http.ts'
import type {
  AuthContext,
  GenerateParse,
  ImageGenInput,
  MediaProtocol,
  OutputRef,
  RawResponse,
} from '../types.ts'

/**
 * OpenAI 形态的图像接口：`POST {baseUrl}/images/generations`，带参考图时 `POST {baseUrl}/images/edits`。
 *
 * 写法有三种，缺省（方言选项 `imageStyle: 'auto'`）按**模型名**判断，可以在方言选项里显式指定：
 *
 * - **compat**（缺省，所有别的模型名）：以 OpenAI Images API 为最小公约数，容忍 302.AI 这类聚合平台的扩展——
 *   参考图以 data URL 同时填 `image` / `image_url` / `reference_images`，总是要 `b64_json`，会发 `negative_prompt`。
 *   **这一支和原来逐字相同**（302.AI 的 Seedream 预设是实测过的，不能变）。
 * - **openai**（`gpt-image*`、`chatgpt-image*`，OpenAI 官方）：官方说 GPT image 系列不支持 `response_format`
 *   （始终返回 base64）、没有 `negative_prompt`；尺寸 `WxH`（边长 16 的倍数，新模型）或 `auto`；质量
 *   `low|medium|high|auto`；`output_format` 缺省 png。**多参考图走 `POST /images/edits`**，multipart，重复的
 *   `image[]` 文件字段（官方参考页里的示例形式；页面上写明的 schema 是 JSON `images[{image_url|file_id}]`，
 *   1~16 张，两种官方都收）。
 * - **minimax**（`MiniMax-H3-Image*`）：`/images/generations` 和 `/images/edits`，JSON；编辑用
 *   `images:[{image_url}]`（data URL、公网地址或 `mm_file://`，1~16 张）；`response_format: b64_json`；尺寸 `WxH`
 *   时不能同时发 `aspect_ratio` / `area`。服务端最长等 600 秒，且不幂等——重试会再次计费。
 *
 * 响应都是 `data[]`：`b64_json` 或 `url`；`data[].error` 表示这一张失败，只要有一张成功 HTTP 就是 200。
 */

export type OpenAiImageStyle = 'compat' | 'openai' | 'minimax'

/**
 * 写法：显式指定的优先；`auto`（缺省）按模型名判断。判断前先去掉 `openai/gpt-image-1`、`MiniMax/…` 这类
 * 路径前缀，只看最后一段——聚合平台常用带前缀的名字。
 * 注意：经转发站使用 `gpt-image-*` 时，自动判断仍会选 `openai`（multipart `/images/edits`），转发站是否支持未知；
 * 不支持就显式指定 `compat`。
 */
export function openAiImageStyle(
  model: string,
  explicit?: 'auto' | OpenAiImageStyle,
): OpenAiImageStyle {
  if (explicit && explicit !== 'auto') return explicit
  const name = model.split('/').pop() ?? model
  if (/^(gpt-image|chatgpt-image)/i.test(name)) return 'openai'
  if (/^minimax-h3-image/i.test(name)) return 'minimax'
  return 'compat'
}

const QUALITY_OPENAI = { standard: 'medium', hd: 'high' } as const

export const openaiImages: MediaProtocol<ImageGenInput> = {
  id: 'openai-images',
  media: 'image',

  // 官方：复杂提示最长约 2 分钟；MiniMax：服务端最长等 600 秒，客户端超时至少 600 秒
  requestTimeoutMs: (auth) => {
    const style = openAiImageStyle(auth.model, auth.dialect?.imageStyle)
    return style === 'minimax' ? 620_000 : style === 'openai' ? 300_000 : undefined
  },

  buildGenerateRequest(auth, input) {
    switch (openAiImageStyle(auth.model, auth.dialect?.imageStyle)) {
      case 'openai':
        return buildOpenAi(auth, input)
      case 'minimax':
        return buildMiniMax(auth, input)
      default:
        return buildCompat(auth, input)
    }
  },

  parseGenerateResponse: parseImagesData,
}

/** `data[]`（`b64_json` 或 `url`，`data[].error` 表示这一张失败）。OpenAI、MiniMax、火山方舟共用。 */
export function parseImagesData(raw: RawResponse): GenerateParse {
  const parsed = jsonObjectOrFail(raw, 'Image API ')
  if (!parsed.ok) return parsed.result
  const json = parsed.json
  const data = json.data
  if (!Array.isArray(data) || data.length === 0) {
    return { status: 'failed', message: errorMessageOf(json, 'Image API 没返回任何图片') }
  }
  const outputs: OutputRef[] = []
  let firstError: string | undefined
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
    } else {
      // `data[].error`：这一张失败（其余成功的不受影响）
      const err = asRecord(e.error)
      firstError ??= str(err?.message) ?? str(err?.code)
    }
  }
  if (outputs.length === 0) {
    return {
      status: 'failed',
      message: firstError
        ? `Image API 没有生成图片：${firstError}`
        : 'Image API 返回结构无法识别：缺少 url 与 b64_json',
    }
  }
  return { status: 'sync', outputs }
}

// --- compat：原样保留 ---

function buildCompat(auth: AuthContext, input: ImageGenInput) {
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
}

// --- OpenAI gpt-image ---

function buildOpenAi(auth: AuthContext, input: ImageGenInput) {
  const refs = input.references ?? []
  const fields: Record<string, string> = {
    model: auth.model,
    prompt: input.prompt,
    n: String(input.n ?? 1),
    output_format: 'png',
  }
  if (input.size) fields.size = `${input.size.width}x${input.size.height}`
  if (input.quality) fields.quality = QUALITY_OPENAI[input.quality]
  // 不发 response_format（官方：GPT image 始终返回 base64）、不发 negative_prompt（没有这个字段）
  if (refs.length === 0) {
    const body: Record<string, unknown> = { ...fields, n: input.n ?? 1 }
    return jsonPost(joinUrl(auth.baseUrl, '/images/generations'), body, jsonHeaders(auth.apiKey))
  }
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  refs.forEach((ref, i) => {
    const mime = ref.mime || 'image/png'
    const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
    form.append(
      'image[]',
      new Blob([ref.bytes] as unknown as ConstructorParameters<typeof Blob>[0], { type: mime }),
      `ref_${i + 1}.${ext}`,
    )
  })
  // multipart：不要设 Content-Type（边界由 fetch 生成）
  return {
    method: 'POST' as const,
    url: joinUrl(auth.baseUrl, '/images/edits'),
    headers: authHeaders(auth.apiKey),
    body: { type: 'form' as const, value: form },
  }
}

// --- MiniMax H3 ---

function buildMiniMax(auth: AuthContext, input: ImageGenInput) {
  const refs = input.references ?? []
  const body: Record<string, unknown> = {
    model: auth.model,
    prompt: input.prompt,
    n: input.n ?? 1,
    response_format: 'b64_json',
    output_format: 'png',
  }
  // 给了 WxH 就不能再发 aspect_ratio / area（官方：会 400）
  if (input.size) body.size = `${input.size.width}x${input.size.height}`
  if (refs.length > 0) body.images = refs.map((r) => ({ image_url: toDataUrl(r) }))
  return jsonPost(
    joinUrl(auth.baseUrl, refs.length > 0 ? '/images/edits' : '/images/generations'),
    body,
    jsonHeaders(auth.apiKey),
  )
}
