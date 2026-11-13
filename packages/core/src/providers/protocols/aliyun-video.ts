import { snapDuration } from '../duration.ts'
import {
  asRecord,
  bodyError,
  authHeaders,
  joinPrompt,
  joinUrl,
  jsonHeaders,
  jsonPost,
  str,
  toDataUrl,
} from '../http.ts'
import type { MediaProtocol, OutputRef, VideoGenInput } from '../types.ts'

const DEFAULT_DURATIONS = [3, 4, 5, 10, 15]

/**
 * 阿里云通义万相（DashScope）图生视频，经 302.AI 透传（2026-05 验证）。
 *
 *   POST {baseUrl}/aliyun/api/v1/services/aigc/video-generation/video-synthesis
 *     header: X-DashScope-Async: enable
 *     body: { model, input:{prompt, img_url}, parameters:{resolution, duration, prompt_extend, watermark} }
 *     resp: { output:{ task_id, task_status:"PENDING" } }
 *   GET  {baseUrl}/aliyun/api/v1/tasks/{task_id}
 *     resp: { output:{ task_status: PENDING|RUNNING|SUCCEEDED|FAILED|CANCELED|UNKNOWN, video_url?, message? } }
 *
 * img_url 支持 base64 data URL，无需图床。
 */
export const aliyunVideo: MediaProtocol<VideoGenInput> = {
  id: 'aliyun-video',
  media: 'video',

  buildGenerateRequest(auth, input) {
    const body = {
      model: auth.model,
      input: {
        prompt: joinPrompt(input.prompt, input.cameraInstruction),
        img_url: toDataUrl(input.image),
      },
      parameters: {
        resolution: input.resolution ?? '720P',
        duration: snapDuration(input.durationSec ?? 5, input.allowedDurations ?? DEFAULT_DURATIONS),
        prompt_extend: true,
        watermark: false,
      },
    }
    return jsonPost(
      joinUrl(auth.baseUrl, '/aliyun/api/v1/services/aigc/video-generation/video-synthesis'),
      body,
      jsonHeaders(auth.apiKey, { 'X-DashScope-Async': 'enable' }),
    )
  },

  parseGenerateResponse(raw) {
    const output = asRecord(asRecord(raw.json)?.output)
    const taskId = str(output?.task_id)
    if (!taskId) {
      return { status: 'failed', message: 'Aliyun submit 响应里没找到 output.task_id' }
    }
    return { status: 'async', taskId }
  },

  buildPollRequest(auth, taskId) {
    return {
      method: 'GET',
      url: joinUrl(auth.baseUrl, `/aliyun/api/v1/tasks/${encodeURIComponent(taskId)}`),
      headers: authHeaders(auth.apiKey),
    }
  },

  parsePollResponse(raw) {
    const output = asRecord(asRecord(raw.json)?.output)
    const status = (str(output?.task_status) ?? '').toUpperCase()
    if (!status) {
      const err = bodyError(raw.json)
      if (err) return { status: 'failed', message: err }
    }
    if (status === 'SUCCEEDED' || status === 'SUCCESS') {
      const results = Array.isArray(output?.results) ? output.results : []
      const first = asRecord(results[0])
      const url = str(output?.video_url) ?? str(first?.video_url) ?? str(first?.url)
      if (!url) {
        return {
          status: 'failed',
          message:
            'Aliyun: 任务成功但响应里没找到 video_url（output.video_url 与 output.results[].url 都没值）',
        }
      }
      const outputs: OutputRef[] = [{ kind: 'url', url, mime: 'video/mp4' }]
      return { status: 'completed', outputs }
    }
    if (status === 'FAILED' || status === 'CANCELED') {
      return { status: 'failed', message: str(output?.message) ?? `任务${status.toLowerCase()}` }
    }
    if (status === 'RUNNING') return { status: 'processing' }
    // PENDING / UNKNOWN / 空都按排队处理
    return { status: 'queued' }
  },
}
