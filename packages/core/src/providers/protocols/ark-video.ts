import { bodyError, asRecord, joinPrompt, joinUrl, jsonHeaders, jsonPost, str } from '../http.ts'
import type { MediaProtocol, OutputRef, VideoGenInput } from '../types.ts'
import { videoModeOf } from '../video-input.ts'
import { buildContentArray, capabilityError, dataUrlOf } from './content-array.ts'

/**
 * 火山方舟 Seedance（国内）与 BytePlus ModelArk（国际）直连的视频生成。
 * 依据：方舟官方"创建 / 查询视频生成任务"页（docs.volcengine.com/docs/ark/…，2026-11-13 核对）、错误码页，
 * BytePlus 人像素材指南页（国际站地址与同一套请求体）。**未实测。**
 *
 * 和经 302.AI 透传的 `volcengine-video`（实测过）**不是一回事**：那个带 `/volcengine` 路径前缀、总是带首帧、
 * `generate_audio` 默认 false、比例直接用项目画幅。本协议的差别都来自官方文档：
 *
 *   POST {baseUrl}/contents/generations/tasks        baseUrl 到 `/api/v3`
 *     { model, content:[text, image_url(role)…], resolution, ratio, duration, generate_audio, watermark }
 *     → { id }
 *   GET  {baseUrl}/contents/generations/tasks/{id}
 *     → { status: queued|running|succeeded|failed|expired|cancelled,
 *         content:{ video_url, last_frame_url? }, error:{ code, message }, usage, duration }
 *
 * - 三种场景互斥：首帧（`first_frame`）/ 首尾帧 / 全模态参考（`reference_image`…），不能混用；
 * - 带首帧的任务 `ratio` 只能是 `adaptive`（Seedance 2.5 官方要求，输出比例跟随首帧）；文生视频和参考任务用项目画幅；
 * - `generate_audio` 官方默认 true，所以**总是显式发**；`watermark: false`；不发 seed / camera_fixed / frames（仅 1.0 pro）；
 * - 本地图片走 `data:image/<小写格式>;base64,…`（单张 < 30MB，请求体 ≤ 64MB）；参考视频只收公网地址或 `asset://`，
 *   本地字节不支持（没有上传通道）；
 * - 结果地址 24 小时有效（2.5 每个地址最多下载 100 次），任务号 7 天；成功后由执行器立即下载。
 */

export const arkVideo: MediaProtocol<VideoGenInput> = {
  id: 'ark-video',
  media: 'video',

  buildGenerateRequest(auth, input) {
    const mode = videoModeOf(input)
    const text = joinPrompt(input.prompt, input.cameraInstruction)
    const content = buildContentArray(input, text, {
      serialize(kind, media) {
        if (media.kind === 'url') return media.url
        if (media.kind === 'asset') return `asset://${media.id}`
        if (kind === 'video') {
          throw capabilityError(
            'REFERENCE_KIND_UNSUPPORTED',
            '参考视频只收公网地址或素材 ID（asset://），本地视频需要先上传，本版本没有上传通道',
          )
        }
        return dataUrlOf(media, kind === 'audio' ? 'audio/mpeg' : 'image/png')
      },
    })
    const body: Record<string, unknown> = {
      model: auth.model,
      content,
      resolution: input.resolution ?? '720p',
      ratio:
        mode === 'i2v' || mode === 'first_last' ? 'adaptive' : (input.aspectRatio ?? 'adaptive'),
      duration: Math.round(input.durationSec ?? 5),
      generate_audio: input.withAudio ?? false,
      watermark: false,
    }
    if (input.returnLastFrame) body.return_last_frame = true
    return jsonPost(
      joinUrl(auth.baseUrl, '/contents/generations/tasks'),
      body,
      jsonHeaders(auth.apiKey),
    )
  },

  parseGenerateResponse(raw) {
    const id = str(asRecord(raw.json)?.id)
    if (!id) {
      return { status: 'failed', message: bodyError(raw.json) ?? 'Ark submit 响应里没找到任务 id' }
    }
    return { status: 'async', taskId: id }
  },

  buildPollRequest(auth, taskId) {
    return {
      method: 'GET',
      url: joinUrl(auth.baseUrl, `/contents/generations/tasks/${encodeURIComponent(taskId)}`),
      headers: jsonHeaders(auth.apiKey),
    }
  },

  parsePollResponse(raw) {
    const json = asRecord(raw.json)
    const status = (str(json?.status) ?? '').toLowerCase()
    if (!status) {
      const err = bodyError(raw.json)
      if (err) return { status: 'failed', message: err }
    }
    switch (status) {
      case 'succeeded': {
        const content = asRecord(json?.content)
        const url = str(content?.video_url)
        if (!url) return { status: 'failed', message: 'Ark: 任务成功但缺少 content.video_url' }
        const outputs: OutputRef[] = [{ kind: 'url', url, mime: 'video/mp4', role: 'video' }]
        const last = str(content?.last_frame_url)
        if (last) outputs.push({ kind: 'url', url: last, mime: 'image/jpeg', role: 'last_frame' })
        const d = json?.duration
        return {
          status: 'completed',
          outputs,
          ...(typeof d === 'number' && Number.isFinite(d) ? { durationSec: d } : {}),
        }
      }
      case 'failed': {
        const err = asRecord(json?.error)
        return {
          status: 'failed',
          message: str(err?.message) ?? '任务失败（方舟未提供详细错误）',
          ...(str(err?.code) ? { code: str(err?.code) } : {}),
        }
      }
      case 'expired':
        return {
          status: 'failed',
          message: '任务超时：48 小时内没有完成，已被方舟终止',
          code: 'TASK_EXPIRED',
        }
      case 'cancelled':
        return { status: 'failed', message: '任务已取消', code: 'TASK_CANCELLED' }
      case 'running':
        return { status: 'processing' }
      default:
        return { status: 'queued' } // queued / 空 / 没见过的状态
    }
  },

  parseHttpError(raw) {
    // 官方错误码页给了 HTTP 状态 + 错误类型 + 错误码；响应体的确切形状官方没贴示例，
    // 这里同时认 { error:{ code, message } } 和顶层 { code, message }（未实测）。
    const json = asRecord(raw.json)
    const err = asRecord(json?.error) ?? json
    const code = str(err?.code) ?? str(err?.type)
    const message = str(err?.message)
    const transient = raw.status === 429 || raw.status >= 500
    return { ...(code ? { code } : {}), ...(message ? { message } : {}), recoverable: transient }
  },
}
