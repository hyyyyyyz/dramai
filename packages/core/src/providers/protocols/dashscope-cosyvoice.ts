import { asRecord, bodyError, joinUrl, jsonHeaders, jsonPost, str } from '../http.ts'
import type { MediaProtocol, RawResponse, SpeechInput } from '../types.ts'
import { capabilityError } from './content-array.ts'

/**
 * 阿里百炼 CosyVoice 语音合成，HTTP 非实时（非流式）形态。依据：百炼“CosyVoice 语音合成 HTTP API”“音色列表”页
 * （2026-11-13 核对）。**未实测。**
 *
 *   POST {baseUrl}/api/v1/services/audio/tts/SpeechSynthesizer        头 Authorization: Bearer <Key>
 *     { model, input:{ text, voice, format, rate?, instruction?, language_hints? } }
 *     → { request_id, output:{ finish_reason:"stop", audio:{ url, expires_at, id } }, usage:{ characters } }
 *
 * baseUrl 形如 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com`（官方 HTTP 页只写了北京地域；模型、地址、Key 必须同一地域）。
 *
 * - 成品是 **24 小时有效的链接**：协议给 `url` 输出（带 `mime` 提示——对象存储常给 octet-stream），执行器马上下载，
 *   管线下载成功后立即落盘；
 * - **不能走流式**：请求头 `X-DashScope-SSE: enable` 会让响应变成 SSE 事件流，这里读不了，所以声明为受保护头，
 *   用户的“额外请求头”改不了它；
 * - 所有字段都在 `input` 里（没有 `parameters`）；`speed` 对应 `rate`（0.5–2，超出夹到范围内并报告）；
 * - `instruction`（风格 / 方言 / 情绪指令）官方限制 100 字符且汉字算 2 个：超过由 `inputProblem` 报告——官方地址上的型号准入阶段阻断，
 *   其余（自填型号、中转站）只警告；这里照实发，由上游决定；
 * - `language_hints` 只处理第一项，只发一项；只认官方列出的语言码，其余丢弃并报告；
 * - 错误体：官方这一页没有写错误响应的结构；沿用百炼通用的 `{ code, message }` 读法（与万相协议相同，**未核实**）。
 */

const FORMAT: Record<
  NonNullable<SpeechInput['format']>,
  { format: string; mime: string } | undefined
> = {
  mp3: { format: 'mp3', mime: 'audio/mpeg' },
  wav: { format: 'wav', mime: 'audio/wav' },
  ogg: undefined, // 官方是 opus；封装没有写明，不猜
}

/** 官方列出的 `language_hints` 取值。 */
const LANGUAGES = new Set([
  'zh',
  'en',
  'fr',
  'de',
  'ja',
  'ko',
  'ru',
  'pt',
  'th',
  'id',
  'vi',
  'es',
  'it',
  'ms',
  'fil',
  'ar',
])

const RATE = { min: 0.5, max: 2 }
const INSTRUCTION_MAX = 100
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** 指令长度：汉字（含全角字符）算 2，其余算 1。 */
export function instructionLength(text: string): number {
  let n = 0
  for (const ch of text) n += /[⺀-鿿豈-﫿＀-￯]/.test(ch) ? 2 : 1
  return n
}

function problemOf(input: SpeechInput): { code: string; message: string } | undefined {
  if (input.instructions && instructionLength(input.instructions) > INSTRUCTION_MAX) {
    return {
      code: 'INSTRUCTION_TOO_LONG',
      message: `风格指令太长：CosyVoice 限制 ${INSTRUCTION_MAX} 个字符，汉字算 2 个（现在 ${instructionLength(input.instructions)}）`,
    }
  }
  return undefined
}

export const dashscopeCosyvoice: MediaProtocol<SpeechInput> = {
  id: 'dashscope-cosyvoice',
  media: 'audio',
  // 加上它响应会变成 SSE 事件流，这个协议只读一次性 JSON
  protectedHeaders: ['X-DashScope-SSE'],

  buildGenerateRequest(auth, input) {
    if (!input.voice) {
      throw capabilityError(
        'VOICE_REQUIRED',
        'CosyVoice 的语音合成必须指定音色（voice），请先设置旁白音色',
      )
    }
    const format = FORMAT[input.format ?? 'mp3']
    if (!format) {
      throw capabilityError(
        'FORMAT_UNSUPPORTED',
        `CosyVoice 这一版只发 mp3 / wav，不发 ${input.format}`,
      )
    }
    // 指令太长不在这里抛：它由 `inputProblem` 报告（官方地址上的型号准入就阻断，其余只警告，由上游决定）
    const body: Record<string, unknown> = {
      model: auth.model,
      input: {
        text: input.text,
        voice: input.voice,
        format: format.format,
        ...(input.speed ? { rate: clamp(input.speed, RATE.min, RATE.max) } : {}),
        ...(input.instructions ? { instruction: input.instructions } : {}),
        ...(input.language && LANGUAGES.has(input.language.toLowerCase())
          ? { language_hints: [input.language.toLowerCase()] }
          : {}),
      },
    }
    return jsonPost(
      joinUrl(auth.baseUrl, '/api/v1/services/audio/tts/SpeechSynthesizer'),
      body,
      jsonHeaders(auth.apiKey),
    )
  },

  parseGenerateResponse(raw) {
    const json = asRecord(raw.json)
    if (!json) return { status: 'failed', message: '百炼返回的不是 JSON' }
    const audio = asRecord(asRecord(json.output)?.audio)
    const url = str(audio?.url)
    if (!url) {
      const err = bodyError(json)
      if (err) {
        // 官方这一页没有写错误响应的结构，也没有说哪些错误没有计费：读到了错误也不能断定“没有计费”，
        // 带上码，按“结果不明”处理（重试要用户确认）。HTTP 4xx 仍然按状态码算被拒绝（执行器的通用规则）
        const code = str(json.code)
        return { status: 'failed', message: err, ...(code ? { code } : {}) }
      }
      return { status: 'failed', message: '百炼响应里没有音频地址（output.audio.url 缺失）' }
    }
    if (!/^https?:\/\//i.test(url)) {
      return { status: 'failed', message: '百炼返回的音频地址不是 http(s) 地址' }
    }
    // 成品类型按请求的格式给（响应里没有）；协议只请求 mp3 / wav，这里从地址后缀判断，判断不了就是 mp3
    const mime = /\.wav(\?|$)/i.test(url) ? 'audio/wav' : 'audio/mpeg'
    return { status: 'sync', outputs: [{ kind: 'url', url, mime }] }
  },

  parseHttpError(raw: RawResponse) {
    const json = asRecord(raw.json)
    const code = str(json?.code) ?? (typeof json?.code === 'number' ? String(json.code) : undefined)
    const message = str(json?.message)
    // 限流、服务端临时错误可以稍后再试；鉴权、欠费、参数、内容审核不行
    const transient = raw.status === 429 || raw.status >= 500
    return { ...(code ? { code } : {}), ...(message ? { message } : {}), recoverable: transient }
  },

  inputProblem: (_auth, input) => problemOf(input),

  ignoredInputs(_auth, input) {
    const out: string[] = []
    if (input.language && !LANGUAGES.has(input.language.toLowerCase())) out.push('language')
    if (input.speed && (input.speed < RATE.min || input.speed > RATE.max)) out.push('speed')
    return out
  },
}
