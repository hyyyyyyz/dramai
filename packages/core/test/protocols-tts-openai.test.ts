import { describe, expect, it } from 'vitest'
import { runGeneration } from '../src/providers/executor.ts'
import { openaiTts } from '../src/providers/protocols/index.ts'
import type { AuthContext, HttpRequestSpec } from '../src/providers/types.ts'

/** P3d: what the speech batch adds to `openai-tts` (the old requests are pinned in legacy-tts-pins.test.ts). */

const auth = (model: string): AuthContext => ({
  baseUrl: 'https://api.example.com/v1',
  model,
  apiKey: 'sk-secret',
  method: 'api_key',
})
const body = (spec: HttpRequestSpec) => (spec.body as { value: Record<string, unknown> }).value

describe('openai-tts: instructions', () => {
  it('is sent only for gpt-4o-mini-tts models (the official page: not supported by tts-1 / tts-1-hd)', () => {
    for (const model of ['gpt-4o-mini-tts', 'gpt-4o-mini-tts-2025-12-15', 'GPT-4O-MINI-TTS']) {
      const b = body(
        openaiTts.buildGenerateRequest(auth(model), { text: 'x', instructions: '轻声' }),
      )
      expect(b.instructions, model).toBe('轻声')
    }
    for (const model of ['tts-1', 'tts-1-hd', 'FunAudioLLM/CosyVoice2-0.5B', 'my-own-model']) {
      const b = body(
        openaiTts.buildGenerateRequest(auth(model), { text: 'x', instructions: '轻声' }),
      )
      expect(b, model).not.toHaveProperty('instructions')
    }
  })

  it('an empty instruction is not sent', () => {
    const b = body(
      openaiTts.buildGenerateRequest(auth('gpt-4o-mini-tts'), { text: 'x', instructions: '' }),
    )
    expect(b).not.toHaveProperty('instructions')
  })

  it('reports what it drops, so nothing disappears silently', () => {
    const ign = (
      model: string,
      input: Parameters<NonNullable<typeof openaiTts.ignoredInputs>>[1],
    ) => openaiTts.ignoredInputs!(auth(model), input)
    expect(ign('gpt-4o-mini-tts', { text: 'x', instructions: 'a', language: 'zh' })).toEqual([
      'language',
    ])
    expect(ign('tts-1', { text: 'x', instructions: 'a', language: 'zh' })).toEqual([
      'instructions',
      'language',
    ])
    expect(ign('tts-1', { text: 'x' })).toEqual([])
  })

  it('the key stays in the Authorization header: not in the URL, not in the body', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = []
    await runGeneration(
      openaiTts,
      auth('gpt-4o-mini-tts'),
      { text: 'x', instructions: 'y' },
      {
        fetch: async (url, init) => {
          seen.push({ url, init })
          return new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/mpeg' } })
        },
      },
    )
    expect(seen[0]!.url).not.toContain('sk-secret')
    expect(String(seen[0]!.init?.body)).not.toContain('sk-secret')
    expect((seen[0]!.init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk-secret',
    )
  })
})
