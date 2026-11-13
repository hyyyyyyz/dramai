import { asRecord, bodyError, bytesToBase64, joinUrl, jsonHeaders, jsonPost, str } from '../http.ts'
import type { ImageGenInput, MediaProtocol, OutputRef } from '../types.ts'

/**
 * 可灵（Kling）图像，异步：提交 → 轮询 → 下载。依据：kling.ai 官方 API 文档（image generation / omni image，
 * 2026-11 核对）。host `https://api-singapore.klingai.com`（官方示例，写明"服务器在中国境外的用户"；中国大陆域名
 * 页面没写）。鉴权：新设计 `Authorization: Bearer <API Key>`。
 *
 * - 普通生图（`kling-v3`、`kling-v2-1`）：`POST /v1/images/generations`，单张参考图 `image`；
 * - **Omni**（`kling-image-o1`、`kling-v3-omni`）：`POST /v1/images/omni-image`，`image_list:[{image}]`，
 *   参考图和元素合计最多 10 张；提示词里用 `<<<image_1>>>` 指称第几张（官方示例里另有 `<<element_1>>`，前后不一致，
 *   这里只用图片的写法）。多参考图和角色一致性靠它。
 * - 参考图是**裸 base64，不能带 `data:` 前缀**（官方明确）；JPG/PNG，≤10MB，≥300px，宽高比 1:2.5~2.5:1。
 * - `model_name` 显式给（官方说空值会走 V1，和"缺省 kling-v3"自相矛盾）。
 * - 提交响应 `{ code, message, request_id, data:{ task_id, task_status } }`；轮询
 *   `GET /v1/images/{generations|omni-image}/{task_id}`，`data.task_status` 为 `submitted|processing|succeed|failed`，
 *   失败原因 `data.task_status_msg`，结果 `data.task_result.images[].url`（Omni 组图在 `series_images`）。
 *   **结果 URL 30 天后清除**，成功后立即下载落盘。
 */

const isOmni = (model: string) => /^(kling-image-o1|kling-v3-omni)$/i.test(model)
const base = (model: string) => (isOmni(model) ? '/v1/images/omni-image' : '/v1/images/generations')

export const klingImage: MediaProtocol<ImageGenInput> = {
  id: 'kling-image',
  media: 'image',

  buildGenerateRequest(auth, input) {
    const refs = input.references ?? []
    const body: Record<string, unknown> = {
      model_name: auth.model,
      prompt: input.prompt,
      n: input.n ?? 1,
      resolution: '1k',
      watermark_info: { enabled: false },
    }
    if (input.aspectRatio) body.aspect_ratio = input.aspectRatio
    if (isOmni(auth.model)) {
      if (refs.length > 0)
        body.image_list = refs.slice(0, 10).map((r) => ({ image: bytesToBase64(r.bytes) }))
    } else {
      // 普通生图只收一张参考图；设了 image 就不支持 negative_prompt
      if (refs[0]) body.image = bytesToBase64(refs[0].bytes)
      else if (input.negativePrompt) body.negative_prompt = input.negativePrompt
    }
    return jsonPost(joinUrl(auth.baseUrl, base(auth.model)), body, jsonHeaders(auth.apiKey))
  },

  parseGenerateResponse(raw) {
    const json = asRecord(raw.json)
    const taskId = str(asRecord(json?.data)?.task_id)
    if (!taskId) {
      return { status: 'failed', message: str(json?.message) ?? 'Kling 提交响应里没找到 task_id' }
    }
    return { status: 'async', taskId }
  },

  buildPollRequest(auth, taskId) {
    return {
      method: 'GET',
      url: joinUrl(auth.baseUrl, `${base(auth.model)}/${encodeURIComponent(taskId)}`),
      headers: jsonHeaders(auth.apiKey),
    }
  },

  parsePollResponse(raw) {
    const data = asRecord(asRecord(raw.json)?.data)
    const status = (str(data?.task_status) ?? 'unknown').toLowerCase()
    // `{ code: 非 0, message }` 且没有任务状态 = 业务错误（鉴权失败 / 任务不存在…），不是"排队中"
    if (!str(data?.task_status)) {
      const err = bodyError(raw.json)
      if (err) return { status: 'failed', message: err }
    }
    if (status === 'succeed' || status === 'succeeded') {
      const result = asRecord(data?.task_result)
      const list = [result?.images, result?.series_images].find((x) => Array.isArray(x)) as
        | unknown[]
        | undefined
      const outputs: OutputRef[] = []
      for (const item of list ?? []) {
        const url = str(asRecord(item)?.url)
        if (url) outputs.push({ kind: 'url', url })
      }
      if (outputs.length === 0)
        return { status: 'failed', message: 'Kling: 任务成功但缺少 images[].url' }
      return { status: 'completed', outputs }
    }
    if (status === 'failed' || status === 'fail' || status === 'error') {
      return { status: 'failed', message: str(data?.task_status_msg) ?? 'Kling 任务失败' }
    }
    if (status === 'processing')
      return { status: 'processing', message: str(data?.task_status_msg) }
    return { status: 'queued' }
  },
}
