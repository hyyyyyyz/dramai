import {
  asRecord,
  bodyError,
  bytesToBase64,
  joinPrompt,
  joinUrl,
  jsonHeaders,
  jsonPost,
  str,
} from '../http.ts'
import type { MediaPayload, MediaProtocol, OutputRef, VideoGenInput } from '../types.ts'
import { videoModeOf } from '../video-input.ts'
import { capabilityError } from './content-array.ts'

/**
 * 可灵 4.0 / 4.0 Flash 的新接口（`contents[]` + `settings` + `options`，API Key 的 Bearer 鉴权）。
 * 依据：kling.ai 官方 API 文档（Kling 4.0 的文生视频、图生视频、Omni 页、鉴权页、错误码页、4.0 Flash Omni 页，
 * 2026-11-13 核对；国内站只核对了鉴权页的域名）。**未实测。** 旧版 `kling-video`（`/v1/videos/image2video`）不变。
 *
 * 域名：国际 `https://api-singapore.klingai.com`，国内 `https://api-beijing.klingai.com`。
 * 路径里带模型名（`auth.model`，如 `kling-4.0` / `kling-4.0-flash`），按任务类型选端点：
 *
 *   t2v          4.0   POST /text-to-video/{model}    顶层 { prompt, settings, options }（不是 contents）
 *   i2v/首尾帧   4.0   POST /image-to-video/{model}   { contents:[prompt, first_frame, last_frame], settings, options }
 *   带参考图     4.0   POST /omni-video/{model}       { contents:[prompt, first_frame?, refer_image…, last_frame?], … }
 *   全部         Flash POST /omni-video/{model}       Flash 只有 Omni 页；文生视频只带 prompt（官方没给纯文本示例，未验证）
 *
 * - **首帧可以和参考图同发**（三家里唯一）；`first_frame` 排在图片最前、`last_frame` 最后；第 n 张参考图的 `id` 固定是
 *   `image_n`，提示词里用 `@image_n` 指称；
 * - `settings`：`duration` 3–30（Flash 3–20）总是显式；`resolution` 4.0 为 720p / 1080p，Flash 只有 720p；
 *   `aspect_ratio` 只有文生视频和 Omni 才有（带首帧写 `adaptive`）；Omni 的 `audio` 只有 `native` / `original`，
 *   **没有关闭**——不要求人声时我们不发，上游照样可能带一条原声（合成阶段会把它静音）；
 * - 本地图片是**裸 base64**（和旧版、`kling-image` 一致；新接口只写"URL 或 Base64"，没写要不要 `data:` 前缀，未验证）；
 * - 提交响应 `{ code, message, request_id, data:{ id, status } }`，轮询 `GET /tasks?task_ids={id}`，`data` 是**数组**；
 *   状态 `submitted | processing | succeeded | failed`；结果 `outputs[]` 里 `type:'video'` 的 `url`
 *   （防盗链，保留 30 天，成功后立即下载）；失败原因在 `message`；
 * - 错误：HTTP 状态非 200 时 `code` 是业务码（1000–1004 鉴权，1101/1102 欠费 / 资源包用完，1103 无权，1201 参数，
 *   1203 资源不存在，1301 内容安全，1302 请求过快，1303 并发超限，5000–5002 服务端）。
 */

/** 新接口的 base64 是否带 `data:` 前缀：文档没写，按旧版 / kling-image 的明确要求先发裸 base64。 */
const BASE64_WITH_DATA_PREFIX = false

const isFlash = (model: string) => /flash/i.test(model)

function imageValue(media: MediaPayload): string {
  if (media.kind === 'url') return media.url
  if (media.kind === 'bytes') {
    const raw = bytesToBase64(media.bytes)
    return BASE64_WITH_DATA_PREFIX ? `data:${media.mime || 'image/png'};base64,${raw}` : raw
  }
  throw capabilityError(
    'REFERENCE_KIND_UNSUPPORTED',
    '可灵的主体（element）需要先在可灵里创建，本版本不支持素材 ID 形式的参考',
  )
}

type Endpoint = { path: string; shape: 'prompt' | 'contents' }

function endpointFor(model: string, mode: ReturnType<typeof videoModeOf>): Endpoint {
  if (isFlash(model)) return { path: `/omni-video/${model}`, shape: 'contents' }
  switch (mode) {
    case 't2v':
      return { path: `/text-to-video/${model}`, shape: 'prompt' }
    case 'omni_ref':
      return { path: `/omni-video/${model}`, shape: 'contents' }
    default:
      return { path: `/image-to-video/${model}`, shape: 'contents' }
  }
}

export const klingContents: MediaProtocol<VideoGenInput> = {
  id: 'kling-contents',
  media: 'video',

  buildGenerateRequest(auth, input) {
    const mode = videoModeOf(input)
    if (input.lastImage && !input.image) {
      throw capabilityError('FIRST_FRAME_REQUIRED', '只给尾帧、没有首帧：可灵不支持')
    }
    const text = joinPrompt(input.prompt, input.cameraInstruction)
    const endpoint = endpointFor(auth.model, mode)
    const omni = endpoint.path.startsWith('/omni-video')

    const settings: Record<string, unknown> = {
      resolution: input.resolution ?? '720p',
      duration: Math.round(input.durationSec ?? 5),
    }
    if (omni || mode === 't2v') {
      const withFrame = Boolean(input.image)
      settings.aspect_ratio = withFrame
        ? 'adaptive'
        : (input.aspectRatio ?? (omni ? 'adaptive' : '16:9'))
    }
    if (omni && input.withAudio) settings.audio = 'native'
    const options = { watermark_info: { enabled: false } }

    let body: Record<string, unknown>
    if (endpoint.shape === 'prompt') {
      body = { prompt: text, settings, options }
    } else {
      const contents: Array<Record<string, unknown>> = [{ type: 'prompt', text }]
      if (input.image) {
        contents.push({ type: 'first_frame', url: imageValue({ kind: 'bytes', ...input.image }) })
      }
      let images = 0
      let videos = 0
      for (const r of input.references ?? []) {
        if (r.kind === 'image') {
          images += 1
          contents.push({ type: 'refer_image', url: imageValue(r.media), id: `image_${images}` })
        } else if (r.kind === 'video' && r.media.kind === 'url') {
          videos += 1
          contents.push({ type: 'feature_video', url: r.media.url, id: `video_${videos}` })
        } else {
          throw capabilityError(
            'REFERENCE_KIND_UNSUPPORTED',
            r.kind === 'video'
              ? '参考视频只收公网地址，本地视频需要先上传，本版本没有上传通道'
              : '可灵没有参考音频，音色要通过音色库（voice_id）引用，本版本不支持',
          )
        }
      }
      if (input.lastImage) {
        contents.push({
          type: 'last_frame',
          url: imageValue({ kind: 'bytes', ...input.lastImage }),
        })
      }
      body = { contents, settings, options }
    }
    return jsonPost(joinUrl(auth.baseUrl, endpoint.path), body, jsonHeaders(auth.apiKey))
  },

  parseGenerateResponse(raw) {
    const json = asRecord(raw.json)
    const err = bodyError(raw.json)
    if (err) return { status: 'failed', message: err }
    const id = str(asRecord(json?.data)?.id)
    if (!id) return { status: 'failed', message: 'Kling submit 响应里没找到 data.id' }
    return { status: 'async', taskId: id }
  },

  buildPollRequest(auth, taskId) {
    return {
      method: 'GET',
      url: `${joinUrl(auth.baseUrl, '/tasks')}?task_ids=${encodeURIComponent(taskId)}`,
      headers: jsonHeaders(auth.apiKey),
    }
  },

  parsePollResponse(raw) {
    const json = asRecord(raw.json)
    const data = json?.data
    const task = asRecord(Array.isArray(data) ? data[0] : undefined)
    const status = (str(task?.status) ?? '').toLowerCase()
    if (!status) {
      const err = bodyError(raw.json)
      if (err) return { status: 'failed', message: err }
      return { status: 'queued' } // 刚提交时查不到 / 没有状态：继续等
    }
    switch (status) {
      case 'succeeded': {
        const outputs = Array.isArray(task?.outputs) ? task.outputs : []
        const video = outputs.map(asRecord).find((o) => o?.type === 'video' && str(o.url))
        const url = str(video?.url)
        if (!url) return { status: 'failed', message: 'Kling: 任务成功但 outputs 里没有视频地址' }
        const d = Number(video?.duration)
        const out: OutputRef[] = [{ kind: 'url', url, mime: 'video/mp4', role: 'video' }]
        return {
          status: 'completed',
          outputs: out,
          ...(Number.isFinite(d) && d > 0 ? { durationSec: d } : {}),
        }
      }
      case 'failed':
        return { status: 'failed', message: str(task?.message) ?? 'Kling 任务失败（未提供原因）' }
      case 'processing':
        return {
          status: 'processing',
          ...(str(task?.message) ? { message: str(task?.message) } : {}),
        }
      default:
        return { status: 'queued' } // submitted / 没见过的状态
    }
  },

  parseHttpError(raw) {
    const json = asRecord(raw.json)
    const code = json?.code
    const message = str(json?.message)
    const n = typeof code === 'number' ? code : Number(code)
    const known = Number.isFinite(n) && n !== 0
    return {
      ...(known ? { code: `KLING_${n}` } : {}),
      ...(message ? { message } : {}),
      // 请求过快 / 并发超限 / 服务端临时错误可以稍后再试；欠费、无权、参数和内容安全不行
      recoverable: [1302, 1303, 5000, 5001, 5002].includes(n) || (!known && raw.status >= 500),
    }
  },
}
