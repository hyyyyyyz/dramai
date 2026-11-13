import {
  asRecord,
  bodyError,
  joinPrompt,
  joinUrl,
  jsonHeaders,
  jsonPost,
  str,
  toDataUrl,
} from '../http.ts'
import type { MediaProtocol, OutputRef, ImageToVideoInput } from '../types.ts'

/**
 * 火山方舟（Volcengine）即梦 Seedance 系列图生视频，经 302.AI 透传（2026-05 验证）。
 *
 *   POST {baseUrl}/volcengine/api/v3/contents/generations/tasks
 *     body: { model, content:[{type:"text",text},{type:"image_url",image_url:{url}}],
 *             ratio, duration, resolution, generate_audio, watermark }
 *     resp: { id }
 *   GET  {baseUrl}/volcengine/api/v3/contents/generations/tasks/{id}
 *     resp: { status: queued|running|succeeded|failed|expired, content:{video_url}, error:{code,message} }
 *
 * 首尾帧（`role: first_frame/last_frame`）只在调用方给了 `lastImage` 时发出，并由模型能力
 * （lastFrame）把关；本协议实现未经实测。
 */
export const volcengineVideo: MediaProtocol<ImageToVideoInput> = {
  id: 'volcengine-video',
  media: 'video',

  buildGenerateRequest(auth, input) {
    const content: Array<Record<string, unknown>> = []
    const text = joinPrompt(input.prompt, input.cameraInstruction)
    if (text) content.push({ type: 'text', text })
    const withLast = Boolean(input.lastImage)
    content.push({
      type: 'image_url',
      image_url: { url: toDataUrl(input.image) },
      ...(withLast ? { role: 'first_frame' } : {}),
    })
    if (input.lastImage) {
      content.push({
        type: 'image_url',
        image_url: { url: toDataUrl(input.lastImage) },
        role: 'last_frame',
      })
    }
    const body = {
      model: auth.model,
      content,
      ratio: input.aspectRatio ?? 'adaptive',
      duration: input.durationSec ?? 5,
      resolution: input.resolution ?? '720p',
      generate_audio: input.withAudio ?? false,
      watermark: false,
    }
    return jsonPost(
      joinUrl(auth.baseUrl, '/volcengine/api/v3/contents/generations/tasks'),
      body,
      jsonHeaders(auth.apiKey),
    )
  },

  parseGenerateResponse(raw) {
    const id = str(asRecord(raw.json)?.id)
    if (!id) return { status: 'failed', message: 'Volcengine submit 响应里没找到 task id' }
    return { status: 'async', taskId: id }
  },

  buildPollRequest(auth, taskId) {
    return {
      method: 'GET',
      url: joinUrl(
        auth.baseUrl,
        `/volcengine/api/v3/contents/generations/tasks/${encodeURIComponent(taskId)}`,
      ),
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
    if (status === 'succeeded' || status === 'success') {
      const content = asRecord(json?.content)
      const url = str(content?.video_url) ?? str(content?.videoUrl)
      if (!url) return { status: 'failed', message: 'Volcengine: 任务成功但缺少 content.video_url' }
      const outputs: OutputRef[] = [{ kind: 'url', url, mime: 'video/mp4' }]
      return { status: 'completed', outputs }
    }
    if (
      status === 'failed' ||
      status === 'error' ||
      status === 'expired' ||
      status === 'cancelled'
    ) {
      return {
        status: 'failed',
        message:
          str(asRecord(json?.error)?.message) ??
          `任务${status || '失败'}（火山方舟未提供详细错误）`,
      }
    }
    if (status === 'running') return { status: 'processing' }
    return { status: 'queued' }
  },
}
