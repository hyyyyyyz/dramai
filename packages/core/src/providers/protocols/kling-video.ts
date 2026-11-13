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
import type { MediaProtocol, OutputRef, ImageToVideoInput } from '../types.ts'

/**
 * Kling 图生视频（公开协议）。
 *   POST {baseUrl}/v1/videos/image2video
 *     body: { model_name, image(base64), prompt, duration:"5"|"10", aspect_ratio? }
 *     resp: { data:{ task_id, task_status:"submitted" } }
 *   GET  {baseUrl}/v1/videos/image2video/{task_id}
 *     resp: { data:{ task_status, task_status_msg?, task_result:{ videos:[{url,duration}] } } }
 *
 * 尾帧（`image_tail`）只在调用方给了 `lastImage` 时发出，实现未经实测。
 */
export const klingVideo: MediaProtocol<ImageToVideoInput> = {
  id: 'kling-video',
  media: 'video',

  buildGenerateRequest(auth, input) {
    const body: Record<string, unknown> = {
      model_name: auth.model,
      image: bytesToBase64(input.image.bytes),
      prompt: joinPrompt(input.prompt, input.cameraInstruction),
      duration: String(input.durationSec ?? 5),
    }
    if (input.lastImage) body.image_tail = bytesToBase64(input.lastImage.bytes)
    if (input.aspectRatio) body.aspect_ratio = input.aspectRatio
    return jsonPost(joinUrl(auth.baseUrl, '/v1/videos/image2video'), body, jsonHeaders(auth.apiKey))
  },

  parseGenerateResponse(raw) {
    const json = asRecord(raw.json)
    const taskId = str(asRecord(json?.data)?.task_id) ?? str(json?.task_id)
    if (!taskId) return { status: 'failed', message: 'Kling submit 响应里没找到 task_id' }
    return { status: 'async', taskId }
  },

  buildPollRequest(auth, taskId) {
    return {
      method: 'GET',
      url: joinUrl(auth.baseUrl, `/v1/videos/image2video/${encodeURIComponent(taskId)}`),
      headers: jsonHeaders(auth.apiKey),
    }
  },

  parsePollResponse(raw) {
    const data = asRecord(asRecord(raw.json)?.data)
    const status = (str(data?.task_status) ?? 'unknown').toLowerCase()
    if (!str(data?.task_status)) {
      const err = bodyError(raw.json)
      if (err) return { status: 'failed', message: err }
    }
    if (status === 'succeed' || status === 'succeeded' || status === 'success') {
      const videos = asRecord(data?.task_result)?.videos
      const v = asRecord(Array.isArray(videos) ? videos[0] : undefined)
      const url = str(v?.url)
      if (!url) return { status: 'failed', message: 'Kling: 任务成功但缺少 video.url' }
      const rawDur = v?.duration
      const dur =
        typeof rawDur === 'number'
          ? rawDur
          : typeof rawDur === 'string'
            ? Number(rawDur)
            : undefined
      const outputs: OutputRef[] = [{ kind: 'url', url, mime: 'video/mp4' }]
      return {
        status: 'completed',
        outputs,
        durationSec: dur !== undefined && Number.isFinite(dur) ? dur : undefined,
      }
    }
    if (status === 'failed' || status === 'fail' || status === 'error') {
      return { status: 'failed', message: str(data?.task_status_msg) ?? 'Kling 任务失败' }
    }
    if (status === 'processing' || status === 'running') {
      return { status: 'processing', message: str(data?.task_status_msg) }
    }
    return { status: 'queued' }
  },
}
