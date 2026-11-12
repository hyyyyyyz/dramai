import {
  asRecord,
  authHeaders,
  joinPrompt,
  joinUrl,
  jsonHeaders,
  jsonPost,
  str,
  toDataUrl,
} from '../http.ts'
import type { MediaProtocol, OutputRef, VideoGenInput } from '../types.ts'

/**
 * 通用 OpenAI 兼容图生视频（best-effort；业界没有统一标准，这里取最常见的形态）。
 *   POST {baseUrl}/videos/generations
 *     body: { model, prompt, image(data URL), image_url, duration?, aspect_ratio? }
 *     resp: { id, status }
 *   GET  {baseUrl}/videos/generations/{id}
 *     resp: { status, output.url | video.url | data[0].url | url }
 */
export const genericVideo: MediaProtocol<VideoGenInput> = {
  id: 'generic-video',
  media: 'video',

  buildGenerateRequest(auth, input) {
    const dataUrl = toDataUrl(input.image)
    const body: Record<string, unknown> = {
      model: auth.model,
      prompt: joinPrompt(input.prompt, input.cameraInstruction),
      image: dataUrl,
      image_url: dataUrl,
    }
    if (input.durationSec) body.duration = input.durationSec
    if (input.aspectRatio) body.aspect_ratio = input.aspectRatio
    return jsonPost(joinUrl(auth.baseUrl, '/videos/generations'), body, jsonHeaders(auth.apiKey))
  },

  parseGenerateResponse(raw) {
    const json = asRecord(raw.json)
    const data = asRecord(json?.data)
    const taskId =
      str(json?.id) ??
      str(json?.task_id) ??
      str(json?.request_id) ??
      str(data?.id) ??
      str(data?.task_id)
    if (!taskId) return { status: 'failed', message: 'Video submit 响应里没找到任务 id' }
    return { status: 'async', taskId }
  },

  buildPollRequest(auth, taskId) {
    return {
      method: 'GET',
      url: joinUrl(auth.baseUrl, `/videos/generations/${encodeURIComponent(taskId)}`),
      headers: authHeaders(auth.apiKey),
    }
  },

  parsePollResponse(raw) {
    const json = asRecord(raw.json) ?? {}
    const status = String(json.status ?? json.state ?? '').toLowerCase()
    if (['completed', 'succeeded', 'success', 'done'].includes(status)) {
      const url = pickVideoUrl(json)
      if (!url) return { status: 'failed', message: 'Video poll: 任务成功但缺少 url' }
      const outputs: OutputRef[] = [{ kind: 'url', url, mime: 'video/mp4' }]
      return { status: 'completed', outputs }
    }
    if (status === 'failed' || status === 'error') {
      return { status: 'failed', message: pickError(json) }
    }
    if (['processing', 'running', 'in_progress'].includes(status)) return { status: 'processing' }
    return { status: 'queued' }
  },
}

function pickVideoUrl(json: Record<string, unknown>): string | undefined {
  const direct = str(json.url) ?? str(json.video_url)
  if (direct) return direct
  const output = json.output
  const outObj = asRecord(output)
  if (str(outObj?.url)) return str(outObj?.url)
  if (Array.isArray(output)) {
    const u = str(asRecord(output[0])?.url)
    if (u) return u
  }
  const videoUrl = str(asRecord(json.video)?.url)
  if (videoUrl) return videoUrl
  const data = json.data
  if (Array.isArray(data)) return str(asRecord(data[0])?.url)
  return str(asRecord(data)?.url)
}

function pickError(json: Record<string, unknown>): string {
  const direct = json.error ?? json.message
  if (typeof direct === 'string') return direct
  const msg = str(asRecord(direct)?.message)
  return msg ?? '视频任务失败'
}
