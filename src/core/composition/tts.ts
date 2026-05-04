import type { Provider } from '@/types/domain'

export interface TtsRequest {
  model: string
  /** 中文/英文文本。 */
  text: string
  /** "alloy" / "nova" / 服务商自己的 voice id。 */
  voice?: string
  /** "mp3" / "wav" / "ogg"。 */
  format?: 'mp3' | 'wav' | 'ogg'
  speed?: number
  signal?: AbortSignal
}

/**
 * OpenAI 兼容的 Text-to-Speech：POST `${baseUrl}/audio/speech`，
 * body 见 OpenAI 文档。返回的就是音频字节流。
 *
 * 用户在 dramai 里把 TTS 配成一个独立 provider（kind 仍按 'llm' 暂时复用，
 * v0.5+ 可以加一个 'tts' kind）。当前版本：暂时让用户在普通 LLM provider
 * 里直接用，传给本函数的 baseUrl/key 即可。
 */
export async function generateTtsAudio(
  provider: Pick<Provider, 'baseUrl' | 'apiKey'>,
  req: TtsRequest,
): Promise<Blob> {
  const url = `${provider.baseUrl.replace(/\/+$/, '')}/audio/speech`
  const body: Record<string, unknown> = {
    model: req.model,
    input: req.text,
    voice: req.voice ?? 'alloy',
    response_format: req.format ?? 'mp3',
  }
  if (req.speed) body.speed = req.speed

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: req.signal,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`TTS HTTP ${res.status}: ${detail.slice(0, 200)}`)
  }
  return res.blob()
}
