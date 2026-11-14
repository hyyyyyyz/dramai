import { joinUrl, jsonHeaders, jsonPost } from '../http.ts'
import type { MediaProtocol, SpeechInput } from '../types.ts'

const MIME: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg' }

/**
 * 官方：`instructions` 只有 `gpt-4o-mini-tts*` 支持，`tts-1` / `tts-1-hd` 不支持（OpenAI speech 参考页，2026-11-13）。
 * 其他型号（硅基流动、各种中转、自填型号）不认这个字段，所以只对这个型号名发。
 */
function isSiliconflow(baseUrl: string): boolean {
  try {
    return /^api\.siliconflow\.(cn|com)$/i.test(new URL(baseUrl).hostname)
  } catch {
    return false
  }
}

const takesInstructions = (model: string) => /^gpt-4o-mini-tts/i.test(model)

/**
 * OpenAI 兼容 Text-to-Speech：`POST {baseUrl}/audio/speech`，响应就是音频字节。
 * 同步协议，没有轮询。硅基流动等兼容服务直接用它（`voice` 原样透传，如 `FunAudioLLM/CosyVoice2-0.5B:alex`）。
 *
 * 请求体只有 `model / input / voice / response_format`，设了 `speed` 才有 `speed`；设了 `instructions` 且型号支持才有 `instructions`。
 * `language` 这个协议没有对应字段，丢弃并由 `ignoredInputs` 报告。
 */
export const openaiTts: MediaProtocol<SpeechInput> = {
  id: 'openai-tts',
  media: 'audio',
  responseType: 'binary',

  buildGenerateRequest(auth, input) {
    const body: Record<string, unknown> = {
      model: auth.model,
      input: input.text,
      voice: input.voice ?? 'alloy',
      response_format: input.format ?? 'mp3',
    }
    if (input.speed) body.speed = input.speed
    if (input.instructions && takesInstructions(auth.model)) body.instructions = input.instructions
    return jsonPost(joinUrl(auth.baseUrl, '/audio/speech'), body, {
      ...jsonHeaders(auth.apiKey),
    })
  },

  parseGenerateResponse(raw) {
    if (!raw.bytes || raw.bytes.byteLength === 0) {
      return { status: 'failed', message: 'TTS 响应为空' }
    }
    const header = raw.headers['content-type']?.split(';')[0]?.trim()
    const mime = header && header.startsWith('audio/') ? header : MIME.mp3
    return { status: 'sync', outputs: [{ kind: 'bytes', bytes: raw.bytes, mime }] }
  },

  inputProblem(auth, input) {
    // 硅基流动的音色写作“模型名:音色名”（或上传得到的 speech:… 地址）；只对它的地址检查，其他 OpenAI 兼容服务不受影响
    if (!isSiliconflow(auth.baseUrl)) return undefined
    const v = input.voice ?? ''
    if (v === '' || v.startsWith('speech:') || v.startsWith(`${auth.model}:`)) return undefined
    return {
      code: 'VOICE_FORMAT_INVALID',
      message: `硅基流动的音色要写成“模型名:音色名”（如 ${auth.model}:alex），或上传参考音频得到的 speech:… 地址；现在是“${v}”`,
    }
  },

  ignoredInputs(auth, input) {
    const out: string[] = []
    if (input.instructions && !takesInstructions(auth.model)) out.push('instructions')
    if (input.language) out.push('language')
    return out
  },
}
