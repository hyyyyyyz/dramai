import {
  asRecord,
  errorMessageOf,
  joinUrl,
  jsonHeaders,
  jsonPost,
  str,
  toDataUrl,
} from '../http.ts'
import type { ImageGenInput, MediaProtocol, OutputRef } from '../types.ts'

/**
 * 阿里百炼 Qwen-Image（同步形态，文生图和带参考图的编辑）：
 * `POST {baseUrl}/api/v1/services/aigc/multimodal-generation/generation`，`Authorization: Bearer`。
 * baseUrl 按地域和业务空间：`https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com`（国内）、
 * `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com`（国际，新加坡）；Key 按地域绑定，不能混用。
 * 依据：help.aliyun.com 的 qwen-image-api 与 qwen-image-edit-api（2026-11 核对）。
 *
 * 请求体：`{ model, input:{ messages:[{ role:'user', content:[{image}…, {text}] }] }, parameters:{…} }`。
 * - messages 恰好一条 user 消息；content 里**恰好一个 text**（零个或多个会报错）；编辑时放 1~3 个 `{image}`
 *   （URL、`oss://` 或 `data:{mime};base64,…`，每张 ≤10MB），多张时输出比例跟随**最后一张**；
 * - `parameters.size` 是 `宽*高`（星号），总像素 512*512 ~ 2048*2048，会被调整到 16 的倍数；
 * - `n` 1~6；`negative_prompt` ≤500 字；`watermark` 缺省 false；`prompt_extend` 缺省 true（服务端改写提示词），
 *   这里显式关掉——dramai 自己按模型写法编译提示词，不希望再被改写。
 * 响应：`output.choices[0].message.content[].image`，**PNG 的 URL，24 小时有效**（成功后立即下载落盘）。
 * 失败：`{ code, message, request_id }`。不支持 base64 输出。
 *
 * 异步形态（wan 文生图、wan2.6/2.7 组图）这一版没做。
 */
export const dashscopeImage: MediaProtocol<ImageGenInput> = {
  id: 'dashscope-image',
  media: 'image',
  requestTimeoutMs: () => 180_000,

  buildGenerateRequest(auth, input) {
    const content: Array<Record<string, string>> = []
    for (const ref of input.references ?? []) content.push({ image: toDataUrl(ref) })
    content.push({ text: input.prompt })
    const parameters: Record<string, unknown> = {
      n: input.n ?? 1,
      watermark: false,
      prompt_extend: false,
    }
    if (input.size) parameters.size = `${input.size.width}*${input.size.height}`
    if (input.negativePrompt) parameters.negative_prompt = input.negativePrompt.slice(0, 500)
    return jsonPost(
      joinUrl(auth.baseUrl, '/api/v1/services/aigc/multimodal-generation/generation'),
      { model: auth.model, input: { messages: [{ role: 'user', content }] }, parameters },
      jsonHeaders(auth.apiKey),
    )
  },

  parseGenerateResponse(raw) {
    const json = asRecord(raw.json)
    if (!json) return { status: 'failed', message: '百炼返回的不是 JSON' }
    const choices = asRecord(json.output)?.choices
    const outputs: OutputRef[] = []
    if (Array.isArray(choices)) {
      for (const c of choices) {
        const content = asRecord(asRecord(asRecord(c)?.message))?.content
        if (!Array.isArray(content)) continue
        for (const item of content) {
          const url = str(asRecord(item)?.image)
          if (url) outputs.push({ kind: 'url', url, mime: 'image/png' })
        }
      }
    }
    if (outputs.length > 0) return { status: 'sync', outputs }
    const code = str(json.code)
    const message = str(json.message) ?? errorMessageOf(json, '百炼没有返回图片')
    return { status: 'failed', message: code ? `${code}: ${message}` : message }
  },
}
