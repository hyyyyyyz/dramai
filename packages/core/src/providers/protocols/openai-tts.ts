import { joinUrl, jsonHeaders, jsonPost } from '../http.ts'
import type { MediaProtocol, SpeechInput } from '../types.ts'

const MIME: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg' }

/**
 * OpenAI 兼容 Text-to-Speech：`POST {baseUrl}/audio/speech`，响应就是音频字节。
 * 同步协议，没有轮询。
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
}
