import {
  asRecord,
  base64ToBytes,
  bytesToBase64,
  errorMessageOf,
  joinUrl,
  jsonPost,
  str,
} from '../http.ts'
import type { ImageGenInput, MediaProtocol, OutputRef } from '../types.ts'

/**
 * Google Gemini 原生 generateContent 协议下的文生图 / 图生图。
 *
 *   POST {baseUrl}/v1beta/models/{model}:generateContent
 *   body: { contents:[{parts:[{text},{inline_data:{mime_type,data}}...]}],
 *           generationConfig:{ responseModalities:["IMAGE"], imageConfig:{aspectRatio} } }
 *
 * 适用：Google AI Studio 直连 / Vertex / 302.AI 透传 / 部分聚合平台。
 * 302.AI 上 base URL 应为 `https://api.302.ai`（**不带 /v1**）。同时发 Authorization 与
 * x-goog-api-key 两个头以覆盖更多兼容场景。
 * 画幅经 `imageConfig.aspectRatio` 显式传出（不传时服务商会给默认比例）。
 */
export const geminiImage: MediaProtocol<ImageGenInput> = {
  id: 'gemini-image',
  media: 'image',

  buildGenerateRequest(auth, input) {
    const parts: Array<Record<string, unknown>> = [{ text: input.prompt }]
    for (const ref of input.references ?? []) {
      parts.push({
        inline_data: { mime_type: ref.mime || 'image/png', data: bytesToBase64(ref.bytes) },
      })
    }
    const generationConfig: Record<string, unknown> = { responseModalities: ['IMAGE'] }
    if (input.aspectRatio) generationConfig.imageConfig = { aspectRatio: input.aspectRatio }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (auth.apiKey) {
      headers.Authorization = `Bearer ${auth.apiKey}`
      headers['x-goog-api-key'] = auth.apiKey
    }
    return jsonPost(
      joinUrl(auth.baseUrl, `/v1beta/models/${encodeURIComponent(auth.model)}:generateContent`),
      { contents: [{ parts }], generationConfig },
      headers,
    )
  },

  parseGenerateResponse(raw) {
    const json = asRecord(raw.json)
    if (!json) return { status: 'failed', message: 'Gemini 返回的不是 JSON' }
    const outputs: OutputRef[] = []
    const candidates = Array.isArray(json.candidates) ? json.candidates : []
    for (const c of candidates) {
      const content = asRecord(asRecord(c)?.content)
      const parts = Array.isArray(content?.parts) ? content.parts : []
      for (const p of parts) {
        const part = asRecord(p)
        if (!part) continue
        // 同时容忍 snake_case 与 camelCase
        const inline = asRecord(part.inline_data) ?? asRecord(part.inlineData)
        const data = str(inline?.data)
        if (!inline || !data) continue
        const mime = str(inline.mime_type) ?? str(inline.mimeType) ?? 'image/png'
        outputs.push({ kind: 'bytes', bytes: base64ToBytes(data), mime })
      }
    }
    if (outputs.length > 0) return { status: 'sync', outputs }
    const blocked = str(asRecord(json.promptFeedback)?.blockReason)
    if (blocked) return { status: 'failed', message: `Gemini 拒绝了该请求：${blocked}` }
    const finish = str(asRecord(candidates[0])?.finishReason)
    return {
      status: 'failed',
      message: `Gemini Image: candidates 里没找到 inline_data（模型可能没启用 IMAGE 输出${
        finish ? `，finishReason=${finish}` : ''
      }）${raw.status >= 400 ? ` · ${errorMessageOf(json, '')}` : ''}`,
    }
  },
}
