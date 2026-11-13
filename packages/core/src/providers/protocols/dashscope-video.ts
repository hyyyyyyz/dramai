import {
  asRecord,
  authHeaders,
  bodyError,
  joinPrompt,
  joinUrl,
  jsonHeaders,
  jsonPost,
  str,
} from '../http.ts'
import type { MediaPayload, MediaProtocol, OutputRef, VideoGenInput } from '../types.ts'
import { videoModeOf } from '../video-input.ts'
import { capabilityError, dataUrlOf } from './content-array.ts'

/**
 * 通义万相 3.0（`wan3.0-video` / `wan3.0-video-prime`）新接口，百炼原生路径（没有 302.AI 的 `/aliyun` 前缀）。
 * 依据：百炼"万相 3.0 视频生成 API 参考"和错误码页（2026-11-13 核对，北京地域示例；新加坡地域写法与生图预设一致，
 * 没有单独打开）。**未实测。** 旧版 `aliyun-video`（302.AI 透传）不变。
 *
 *   POST {baseUrl}/api/v1/services/aigc/video-generation/video-synthesis        头 X-DashScope-Async: enable
 *     { model, input:{ prompt, media:[{ type, url }] }, parameters:{ resolution, ratio, duration, audio, … } }
 *     → { output:{ task_id, task_status:"PENDING" } }
 *   GET  {baseUrl}/api/v1/tasks/{task_id}
 *     → { output:{ task_status: PENDING|RUNNING|SUCCEEDED|FAILED|CANCELED|UNKNOWN, video_url, code, message }, usage }
 *
 * baseUrl 形如 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com`（模型、地址、Key 必须同一地域）。
 *
 * - **素材组合是白名单**：文生视频只给 `prompt`、不给 `media`；`first_frame` / `last_frame` 与 `reference_*` **互斥**
 *   （同时给就抛 `FRAME_WITH_REFS_UNSUPPORTED`）；
 * - 本地图片走 `data:{MIME};base64,…`；**官方只为图片写了 Base64**，参考视频 / 音频只收公网地址或 `oss://` 临时地址，
 *   本地字节不支持（没有上传通道）；
 * - `resolution` 大写 P（`720P`）；带首帧写 `ratio: adaptive`，其余用项目画幅；`audio` 官方默认 true，所以总是显式发；
 *   `prompt_extend: true`（官方默认；旧协议也发 true）；3.0 没有 `negative_prompt`；
 * - 提示词里用"图1 / 视频1 / 音频1"，按 media 里同类型出现的顺序分别计数；
 * - 结果地址和任务号都只保留 24 小时；`UNKNOWN` = 任务不存在或已过期——**是失败，不是排队**（旧协议把它当排队）。
 */

const url = (media: MediaPayload, kind: 'image' | 'video' | 'audio'): string => {
  if (media.kind === 'url') return media.url
  if (media.kind === 'asset') return media.id // 完整的 oss://… 临时地址
  if (kind !== 'image') {
    throw capabilityError(
      'REFERENCE_KIND_UNSUPPORTED',
      '万相的参考视频 / 音频只收公网地址或 oss:// 临时地址，本地文件需要先上传，本版本没有上传通道',
    )
  }
  return dataUrlOf(media, 'image/png')
}

export const dashscopeVideo: MediaProtocol<VideoGenInput> = {
  id: 'dashscope-video',
  media: 'video',

  buildGenerateRequest(auth, input) {
    const mode = videoModeOf(input)
    const refs = input.references ?? []
    if ((input.image || input.lastImage) && refs.length > 0) {
      throw capabilityError(
        'FRAME_WITH_REFS_UNSUPPORTED',
        '万相 3.0 里首帧 / 首尾帧和参考素材（reference_*）互斥，不能在同一次请求里同时给',
      )
    }
    if (input.lastImage && !input.image) {
      throw capabilityError('FIRST_FRAME_REQUIRED', '只给尾帧、没有首帧：万相不支持')
    }
    const media: Array<{ type: string; url: string }> = []
    if (input.image)
      media.push({ type: 'first_frame', url: url({ kind: 'bytes', ...input.image }, 'image') })
    if (input.lastImage)
      media.push({ type: 'last_frame', url: url({ kind: 'bytes', ...input.lastImage }, 'image') })
    for (const r of refs) media.push({ type: `reference_${r.kind}`, url: url(r.media, r.kind) })

    const prompt = joinPrompt(input.prompt, input.cameraInstruction)
    const body = {
      model: auth.model,
      input: { prompt, ...(media.length > 0 ? { media } : {}) },
      parameters: {
        resolution: input.resolution ?? '720P',
        ratio:
          mode === 'i2v' || mode === 'first_last' ? 'adaptive' : (input.aspectRatio ?? 'adaptive'),
        duration: Math.round(input.durationSec ?? 5),
        audio: input.withAudio ?? false,
        prompt_extend: true,
        watermark: false,
      },
    }
    return jsonPost(
      joinUrl(auth.baseUrl, '/api/v1/services/aigc/video-generation/video-synthesis'),
      body,
      jsonHeaders(auth.apiKey, { 'X-DashScope-Async': 'enable' }),
    )
  },

  parseGenerateResponse(raw) {
    const taskId = str(asRecord(asRecord(raw.json)?.output)?.task_id)
    if (!taskId) {
      return {
        status: 'failed',
        message: bodyError(raw.json) ?? 'DashScope submit 响应里没找到 output.task_id',
      }
    }
    return { status: 'async', taskId }
  },

  buildPollRequest(auth, taskId) {
    return {
      method: 'GET',
      url: joinUrl(auth.baseUrl, `/api/v1/tasks/${encodeURIComponent(taskId)}`),
      headers: authHeaders(auth.apiKey),
    }
  },

  parsePollResponse(raw) {
    const json = asRecord(raw.json)
    const output = asRecord(json?.output)
    const status = (str(output?.task_status) ?? '').toUpperCase()
    if (!status) {
      const err = bodyError(raw.json)
      if (err) return { status: 'failed', message: err }
    }
    switch (status) {
      case 'SUCCEEDED': {
        const videoUrl = str(output?.video_url)
        if (!videoUrl)
          return { status: 'failed', message: 'DashScope: 任务成功但缺少 output.video_url' }
        const outputs: OutputRef[] = [
          { kind: 'url', url: videoUrl, mime: 'video/mp4', role: 'video' },
        ]
        const d = asRecord(json?.usage)?.output_video_duration
        return {
          status: 'completed',
          outputs,
          ...(typeof d === 'number' && Number.isFinite(d) && d > 0 ? { durationSec: d } : {}),
        }
      }
      case 'FAILED':
        return {
          status: 'failed',
          message: str(output?.message) ?? '任务失败（百炼未提供详细错误）',
          ...(str(output?.code) ? { code: str(output?.code) } : {}),
        }
      case 'CANCELED':
        return { status: 'failed', message: '任务已取消', code: 'TASK_CANCELLED' }
      case 'UNKNOWN':
        return {
          status: 'failed',
          message: '任务不存在或已过期（任务号只保留 24 小时）',
          code: 'TASK_UNKNOWN',
        }
      case 'RUNNING':
        return { status: 'processing' }
      default:
        return { status: 'queued' } // PENDING / 空
    }
  },

  parseHttpError(raw) {
    const json = asRecord(raw.json)
    const code = str(json?.code) ?? (typeof json?.code === 'number' ? String(json.code) : undefined)
    const message = str(json?.message)
    // 限流、服务端临时错误可以稍后再试；鉴权、欠费、参数和内容审核（DataInspectionFailed）不行
    const transient = raw.status === 429 || raw.status >= 500
    return { ...(code ? { code } : {}), ...(message ? { message } : {}), recoverable: transient }
  },
}
