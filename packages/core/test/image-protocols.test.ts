import { describe, expect, it } from 'vitest'
import { runGeneration } from '../src/providers/executor.ts'
import { dashscopeImage } from '../src/providers/protocols/dashscope-image.ts'
import { geminiImage } from '../src/providers/protocols/gemini-image.ts'
import { klingImage } from '../src/providers/protocols/kling-image.ts'
import { openaiImages, openAiImageStyle } from '../src/providers/protocols/openai-images.ts'
import {
  SILICONFLOW_QWEN_SIZES,
  siliconflowImages,
} from '../src/providers/protocols/siliconflow-images.ts'
import {
  seedreamMinPixels,
  volcengineImages,
} from '../src/providers/protocols/volcengine-images.ts'
import type {
  AuthContext,
  HttpRequestSpec,
  ImageGenInput,
  MediaProtocol,
  RawResponse,
} from '../src/providers/types.ts'

const auth = (model: string, baseUrl: string): AuthContext => ({
  baseUrl,
  model,
  apiKey: 'sk-img',
  method: 'api_key',
})
const ref = (n: number) => ({ bytes: new Uint8Array([n, n, n]), mime: 'image/png' })
const b64 = (n: number) => Buffer.from([n, n, n]).toString('base64')
const json = (spec: HttpRequestSpec) => (spec.body as { value: Record<string, unknown> }).value
const raw = (body: unknown, status = 200): RawResponse => ({
  status,
  headers: {},
  text: JSON.stringify(body),
  json: body,
})
const input = (extra: Partial<ImageGenInput> = {}): ImageGenInput => ({
  prompt: 'a heroine',
  aspectRatio: '9:16',
  size: { width: 1024, height: 1792 },
  ...extra,
})

describe('openai-images: the legacy (compat) request is byte-for-byte what it was (302.AI Seedream is tested)', () => {
  it('no references', () => {
    const spec = openaiImages.buildGenerateRequest(
      auth('doubao-seedream-5-0-260128', 'https://api.302.ai/doubao'),
      input({ negativePrompt: 'blur', quality: 'hd' }),
    )
    expect(spec.url).toBe('https://api.302.ai/doubao/images/generations')
    expect(spec.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-img',
    })
    expect(json(spec)).toEqual({
      model: 'doubao-seedream-5-0-260128',
      prompt: 'a heroine',
      n: 1,
      response_format: 'b64_json',
      size: '1024x1792',
      quality: 'hd',
      negative_prompt: 'blur',
    })
  })
  it('references go in all three legacy fields, as data URLs', () => {
    const b = json(
      openaiImages.buildGenerateRequest(
        auth('any-compat-model', 'https://relay.example/v1'),
        input({ references: [ref(1), ref(2)] }),
      ),
    )
    const urls = [`data:image/png;base64,${b64(1)}`, `data:image/png;base64,${b64(2)}`]
    expect(b).toMatchObject({ image: urls[0], image_url: urls[0], reference_images: urls })
  })
  it('which style a model name gets', () => {
    for (const [m, s] of [
      ['gpt-image-2.5-sunburst', 'openai'],
      ['chatgpt-image-latest', 'openai'],
      ['GPT-IMAGE-1.5', 'openai'],
      ['MiniMax-H3-Image', 'minimax'],
      ['MiniMax-H3-Image-Highspeed', 'minimax'],
      ['doubao-seedream-5-0-260128', 'compat'],
      ['dall-e-3', 'compat'],
    ] as const) {
      expect(openAiImageStyle(m), m).toBe(s)
    }
  })
})

describe('openai-images: gpt-image (official OpenAI)', () => {
  const A = auth('gpt-image-2.5-flare', 'https://api.openai.com/v1')
  it('text to image: no response_format, no negative_prompt, WxH, quality mapped, png', () => {
    const spec = openaiImages.buildGenerateRequest(
      A,
      input({ negativePrompt: 'blur', quality: 'hd', n: 2 }),
    )
    expect(spec.url).toBe('https://api.openai.com/v1/images/generations')
    const b = json(spec)
    expect(b).toEqual({
      model: 'gpt-image-2.5-flare',
      prompt: 'a heroine',
      n: 2,
      output_format: 'png',
      size: '1024x1792',
      quality: 'high',
    })
    expect(b).not.toHaveProperty('response_format')
    expect(b).not.toHaveProperty('negative_prompt')
    expect(json(openaiImages.buildGenerateRequest(A, input({ quality: 'standard' }))).quality).toBe(
      'medium',
    )
    expect(spec.headers.Authorization).toBe('Bearer sk-img')
  })
  it('with references: POST /images/edits as multipart with repeated image[] files, no JSON content type', () => {
    const spec = openaiImages.buildGenerateRequest(
      A,
      input({ references: [ref(1), ref(2), ref(3)], negativePrompt: 'x' }),
    )
    expect(spec.url).toBe('https://api.openai.com/v1/images/edits')
    expect(spec.headers).toEqual({ Authorization: 'Bearer sk-img' }) // the boundary header comes from fetch
    expect(spec.body!.type).toBe('form')
    const form = (spec.body as { value: FormData }).value
    expect(form.get('model')).toBe('gpt-image-2.5-flare')
    expect(form.get('prompt')).toBe('a heroine')
    expect(form.get('size')).toBe('1024x1792')
    expect(form.get('output_format')).toBe('png')
    expect(form.has('response_format')).toBe(false)
    expect(form.has('negative_prompt')).toBe(false)
    const files = form.getAll('image[]') as File[]
    expect(files).toHaveLength(3)
    expect(files.map((f) => f.name)).toEqual(['ref_1.png', 'ref_2.png', 'ref_3.png'])
    expect(files.every((f) => f.type === 'image/png' && f.size === 3)).toBe(true)
  })
  it('long requests get a long timeout', () => {
    expect(openaiImages.requestTimeoutMs!(A)).toBe(300_000)
    expect(openaiImages.requestTimeoutMs!(auth('MiniMax-H3-Image', 'x'))).toBeGreaterThanOrEqual(
      600_000,
    )
    expect(openaiImages.requestTimeoutMs!(auth('doubao-x', 'x'))).toBeUndefined()
  })
})

describe('openai-images: MiniMax H3', () => {
  const A = auth('MiniMax-H3-Image', 'https://api.minimax.io/v1')
  it('generations: JSON, b64_json, size as WxH only (no aspect_ratio / area)', () => {
    const spec = openaiImages.buildGenerateRequest(A, input())
    expect(spec.url).toBe('https://api.minimax.io/v1/images/generations')
    const b = json(spec)
    expect(b).toEqual({
      model: 'MiniMax-H3-Image',
      prompt: 'a heroine',
      n: 1,
      response_format: 'b64_json',
      output_format: 'png',
      size: '1024x1792',
    })
    for (const k of ['aspect_ratio', 'area', 'negative_prompt']) expect(b).not.toHaveProperty(k)
  })
  it('references: /images/edits with images:[{image_url}] (data URLs)', () => {
    const spec = openaiImages.buildGenerateRequest(A, input({ references: [ref(1), ref(2)] }))
    expect(spec.url).toBe('https://api.minimax.io/v1/images/edits')
    expect(spec.headers['Content-Type']).toBe('application/json')
    expect(json(spec).images).toEqual([
      { image_url: `data:image/png;base64,${b64(1)}` },
      { image_url: `data:image/png;base64,${b64(2)}` },
    ])
  })
})

describe('openai-images: responses (shared parser)', () => {
  const parse = (body: unknown) => openaiImages.parseGenerateResponse(raw(body))
  it('b64_json and url items; a failed item among successes does not fail the call', () => {
    const ok = parse({
      data: [
        { b64_json: b64(7) },
        { error: { code: 'moderation', message: 'blocked' } },
        { url: 'https://x.example/a.png' },
      ],
    })
    expect(ok.status).toBe('sync')
    if (ok.status === 'sync') {
      expect(ok.outputs).toHaveLength(2)
      expect(ok.outputs[0]).toMatchObject({ kind: 'bytes', mime: 'image/png' })
      expect(ok.outputs[1]).toEqual({ kind: 'url', url: 'https://x.example/a.png' })
    }
  })
  it('every item failed → the reason is in the message; top-level errors; garbage', () => {
    expect(
      parse({ data: [{ error: { code: '1026', message: 'sensitive content' } }] }),
    ).toMatchObject({ status: 'failed', message: expect.stringContaining('sensitive content') })
    expect(parse({ error: { message: 'bad key' } })).toMatchObject({
      status: 'failed',
      message: 'bad key',
    })
    expect(parse({ data: [] })).toMatchObject({ status: 'failed' })
    expect(
      openaiImages.parseGenerateResponse({ status: 200, headers: {}, text: 'x' }),
    ).toMatchObject({ status: 'failed' })
  })
})

describe('volcengine-images (Seedream, direct)', () => {
  const A = auth('doubao-seedream-5-5-261028', 'https://ark.cn-beijing.volces.com/api/v3')
  it('text to image: watermark off, b64_json, no n / quality / negative_prompt', () => {
    const spec = volcengineImages.buildGenerateRequest(
      A,
      input({ n: 3, quality: 'hd', negativePrompt: 'x' }),
    )
    expect(spec.url).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations')
    expect(json(spec)).toEqual({
      model: 'doubao-seedream-5-5-261028',
      prompt: 'a heroine',
      response_format: 'b64_json',
      watermark: false,
      size: '1024x1792',
    })
  })
  it('references: one → a string, several → an array, always data URIs in `image` only (not the 302.AI triple)', () => {
    const one = json(volcengineImages.buildGenerateRequest(A, input({ references: [ref(1)] })))
    expect(one.image).toBe(`data:image/png;base64,${b64(1)}`)
    const many = json(
      volcengineImages.buildGenerateRequest(A, input({ references: [ref(1), ref(2), ref(3)] })),
    )
    expect(many.image).toEqual([1, 2, 3].map((n) => `data:image/png;base64,${b64(n)}`))
    for (const k of ['image_url', 'reference_images']) expect(many).not.toHaveProperty(k)
  })
  it('sizes below the model minimum are scaled up keeping the ratio (5.0 lite and 4.5 need 3.68 MP)', () => {
    expect(seedreamMinPixels('doubao-seedream-5-0-260128')).toBe(3_686_400)
    expect(seedreamMinPixels('doubao-seedream-4-5-251128')).toBe(3_686_400)
    expect(seedreamMinPixels('doubao-seedream-5-5-261028')).toBe(921_600)
    expect(seedreamMinPixels('doubao-seedream-5-0-pro-260628')).toBe(921_600)
    const [w, h] = String(
      json(volcengineImages.buildGenerateRequest(auth('doubao-seedream-5-0-260128', 'x'), input()))
        .size,
    )
      .split('x')
      .map(Number)
    expect(w! * h!).toBeGreaterThanOrEqual(3_686_400)
    expect(Math.abs(w! / h! - 1024 / 1792)).toBeLessThan(0.01)
    expect(
      json(volcengineImages.buildGenerateRequest(A, input({ size: { width: 1440, height: 2560 } })))
        .size,
    ).toBe('1440x2560') // big enough: untouched
  })
  it('response: b64_json, url, per-item error (shared data[] parser)', () => {
    const r = volcengineImages.parseGenerateResponse(
      raw({
        model: 'm',
        created: 1,
        data: [{ b64_json: b64(9), size: '1024x1792' }, { error: { code: 'x', message: 'oops' } }],
        usage: { generated_images: 1 },
      }),
    )
    expect(r.status === 'sync' && r.outputs).toHaveLength(1)
  })
})

describe('dashscope-image (Qwen-Image, synchronous)', () => {
  const A = auth('qwen-image-2.0-pro', 'https://ws1.cn-beijing.maas.aliyuncs.com')
  it('text to image: one user message with exactly one text, size with a star, prompt rewriting off, watermark off', () => {
    const spec = dashscopeImage.buildGenerateRequest(A, input({ n: 2, negativePrompt: 'blur' }))
    expect(spec.url).toBe(
      'https://ws1.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    )
    expect(spec.headers.Authorization).toBe('Bearer sk-img')
    expect(json(spec)).toEqual({
      model: 'qwen-image-2.0-pro',
      input: { messages: [{ role: 'user', content: [{ text: 'a heroine' }] }] },
      parameters: {
        n: 2,
        watermark: false,
        prompt_extend: false,
        size: '1024*1792',
        negative_prompt: 'blur',
      },
    })
  })
  it('edit: images first (data URIs), the single text last; the negative prompt is cut at 500 characters', () => {
    const b = json(
      dashscopeImage.buildGenerateRequest(
        A,
        input({ references: [ref(1), ref(2)], negativePrompt: 'n'.repeat(900) }),
      ),
    )
    const content = (b.input as { messages: Array<{ content: unknown[] }> }).messages[0]!
      .content as Array<Record<string, string>>
    expect(content).toEqual([
      { image: `data:image/png;base64,${b64(1)}` },
      { image: `data:image/png;base64,${b64(2)}` },
      { text: 'a heroine' },
    ])
    expect(content.filter((c) => 'text' in c)).toHaveLength(1)
    expect((b.parameters as Record<string, string>).negative_prompt).toHaveLength(500)
  })
  it('response: the image URL at output.choices[].message.content[].image; failures carry code and message', () => {
    const ok = dashscopeImage.parseGenerateResponse(
      raw({
        output: {
          choices: [
            {
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: [{ image: 'https://oss.example/a.png?Expires=1' }],
              },
            },
          ],
        },
        usage: { image_count: 1 },
        request_id: 'r',
      }),
    )
    expect(ok).toEqual({
      status: 'sync',
      outputs: [{ kind: 'url', url: 'https://oss.example/a.png?Expires=1', mime: 'image/png' }],
    })
    expect(
      dashscopeImage.parseGenerateResponse(
        raw({ request_id: 'r', code: 'InvalidParameter', message: 'n must be 1' }, 400),
      ),
    ).toEqual({ status: 'failed', message: 'InvalidParameter: n must be 1' })
    expect(
      dashscopeImage.parseGenerateResponse(
        raw({ code: 'InvalidApiKey', message: 'Invalid API-key provided.' }, 401),
      ),
    ).toMatchObject({ status: 'failed' })
  })
})

describe('siliconflow-images', () => {
  it('Qwen-Image: the recommended size for the aspect, negative prompt, batch_size; response images[].url', () => {
    const A = auth('Qwen/Qwen-Image', 'https://api.siliconflow.cn/v1')
    const spec = siliconflowImages.buildGenerateRequest(A, input({ negativePrompt: 'blur', n: 3 }))
    expect(spec.url).toBe('https://api.siliconflow.cn/v1/images/generations')
    expect(json(spec)).toEqual({
      model: 'Qwen/Qwen-Image',
      prompt: 'a heroine',
      image_size: SILICONFLOW_QWEN_SIZES['9:16'],
      negative_prompt: 'blur',
      batch_size: 3,
    })
    expect(
      siliconflowImages.parseGenerateResponse(
        raw({ images: [{ url: 'https://s.example/1.png' }], timings: { inference: 1.2 }, seed: 5 }),
      ),
    ).toEqual({ status: 'sync', outputs: [{ kind: 'url', url: 'https://s.example/1.png' }] })
    expect(
      siliconflowImages.parseGenerateResponse(
        raw({ code: 50505, message: 'Model service overloaded' }, 503),
      ),
    ).toMatchObject({ status: 'failed', message: 'Model service overloaded' })
  })
  it('edit and Kontext models: one reference as a data URL, in the field that model wants; Qwen-Image-Edit has no image_size', () => {
    const edit = json(
      siliconflowImages.buildGenerateRequest(
        auth('Qwen/Qwen-Image-Edit', 'x'),
        input({ references: [ref(1), ref(2)] }),
      ),
    )
    expect(edit).toEqual({
      model: 'Qwen/Qwen-Image-Edit',
      prompt: 'a heroine',
      image: `data:image/png;base64,${b64(1)}`,
    })
    expect(
      json(
        siliconflowImages.buildGenerateRequest(
          auth('black-forest-labs/FLUX.1-Kontext-pro', 'x'),
          input({ references: [ref(1)] }),
        ),
      ),
    ).toMatchObject({ input_image: `data:image/png;base64,${b64(1)}` })
    expect(
      json(
        siliconflowImages.buildGenerateRequest(
          auth('black-forest-labs/FLUX.1-Kontext-dev', 'x'),
          input({ references: [ref(1)] }),
        ),
      ),
    ).toMatchObject({ image: `data:image/png;base64,${b64(1)}` })
    // a model without reference support never gets one
    expect(
      json(
        siliconflowImages.buildGenerateRequest(
          auth('black-forest-labs/FLUX.2-pro', 'x'),
          input({ references: [ref(1)] }),
        ),
      ),
    ).not.toHaveProperty('image')
  })
})

describe('kling-image (async)', () => {
  const G = auth('kling-v3', 'https://api-singapore.klingai.com')
  const O = auth('kling-image-o1', 'https://api-singapore.klingai.com')
  it('generations: single reference as BARE base64 (no data: prefix); a negative prompt only without an image', () => {
    const spec = klingImage.buildGenerateRequest(
      G,
      input({ references: [ref(1), ref(2)], negativePrompt: 'x' }),
    )
    expect(spec.url).toBe('https://api-singapore.klingai.com/v1/images/generations')
    expect(spec.headers.Authorization).toBe('Bearer sk-img')
    const b = json(spec)
    expect(b).toMatchObject({
      model_name: 'kling-v3',
      prompt: 'a heroine',
      image: b64(1),
      aspect_ratio: '9:16',
      resolution: '1k',
      n: 1,
    })
    expect(String(b.image)).not.toContain('data:')
    expect(b).not.toHaveProperty('negative_prompt')
    expect(
      json(klingImage.buildGenerateRequest(G, input({ negativePrompt: 'x' }))).negative_prompt,
    ).toBe('x')
  })
  it('Omni: /omni-image with image_list of bare base64, at most 10', () => {
    const refs = Array.from({ length: 12 }, (_, i) => ref(i + 1))
    const spec = klingImage.buildGenerateRequest(O, input({ references: refs }))
    expect(spec.url).toBe('https://api-singapore.klingai.com/v1/images/omni-image')
    const list = json(spec).image_list as Array<{ image: string }>
    expect(list).toHaveLength(10)
    expect(list[0]).toEqual({ image: b64(1) })
    expect(json(klingImage.buildGenerateRequest(O, input()))).not.toHaveProperty('image_list')
  })
  it('submit → task id (or a readable failure); poll URL follows the endpoint of the model', () => {
    expect(
      klingImage.parseGenerateResponse(
        raw({ code: 0, data: { task_id: 't1', task_status: 'submitted' } }),
      ),
    ).toEqual({ status: 'async', taskId: 't1' })
    expect(klingImage.parseGenerateResponse(raw({ code: 1102, message: 'balance' }))).toEqual({
      status: 'failed',
      message: 'balance',
    })
    expect(klingImage.buildPollRequest!(G, 't1').url).toBe(
      'https://api-singapore.klingai.com/v1/images/generations/t1',
    )
    expect(klingImage.buildPollRequest!(O, 't 1').url).toBe(
      'https://api-singapore.klingai.com/v1/images/omni-image/t%201',
    )
  })
  it('poll states: processing, success (images or series_images), failure with the reason, success without a URL', () => {
    const poll = (data: unknown) => klingImage.parsePollResponse!(raw({ code: 0, data }))
    expect(poll({ task_status: 'submitted' })).toEqual({ status: 'queued' })
    expect(poll({ task_status: 'processing' })).toMatchObject({ status: 'processing' })
    expect(
      poll({
        task_status: 'succeed',
        task_result: { images: [{ index: 0, url: 'https://k.example/1.png' }] },
      }),
    ).toEqual({ status: 'completed', outputs: [{ kind: 'url', url: 'https://k.example/1.png' }] })
    expect(
      poll({
        task_status: 'succeed',
        task_result: {
          result_type: 'series',
          series_images: [{ url: 'https://k.example/s1.png' }, { url: 'https://k.example/s2.png' }],
        },
      }),
    ).toMatchObject({ status: 'completed', outputs: expect.any(Array) })
    expect(poll({ task_status: 'failed', task_status_msg: 'content blocked' })).toEqual({
      status: 'failed',
      message: 'content blocked',
    })
    expect(poll({ task_status: 'succeed', task_result: { images: [] } })).toMatchObject({
      status: 'failed',
    })
  })
})

describe('gemini-image: direct Google vs relays', () => {
  it('the official address gets only x-goog-api-key (a Bearer API key would be refused); a relay keeps both', () => {
    const direct = geminiImage.buildGenerateRequest(
      auth('gemini-3.1-flash-image', 'https://generativelanguage.googleapis.com'),
      input({ references: [ref(1)] }),
    )
    expect(direct.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent',
    )
    expect(direct.headers['x-goog-api-key']).toBe('sk-img')
    expect(direct.headers).not.toHaveProperty('Authorization')
    const relay = geminiImage.buildGenerateRequest(
      auth('gemini-2.5-flash-image', 'https://api.302.ai'),
      input(),
    )
    expect(relay.headers).toMatchObject({
      Authorization: 'Bearer sk-img',
      'x-goog-api-key': 'sk-img',
    })
  })
})

// --- results are downloaded the moment generation succeeds ---

describe('results are saved right away (URLs expire: 1 hour to 30 days)', () => {
  const calls: string[] = []
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (url.endsWith('/v1/images/omni-image'))
      return new Response(
        JSON.stringify({ code: 0, data: { task_id: 'T9', task_status: 'submitted' } }),
        { status: 200 },
      )
    if (url.endsWith('/v1/images/omni-image/T9'))
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            task_status: 'succeed',
            task_result: { images: [{ url: 'https://cdn.example/out.png' }] },
          },
        }),
        { status: 200 },
      )
    if (url === 'https://cdn.example/out.png')
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      })
    return new Response('{}', { status: 404 })
  }) as never

  it('async: submit → poll → download in the same run; the URL is checkpointed before the download; bytes come back', async () => {
    calls.length = 0
    const order: string[] = []
    const res = await runGeneration(
      klingImage as MediaProtocol<ImageGenInput>,
      auth('kling-image-o1', 'https://api-singapore.klingai.com'),
      input(),
      { fetch: fetchFn, sleep: async () => {} },
      {
        onSubmitted: (id) => void order.push(`submitted ${id}`),
        onResult: (o) => void order.push(`result ${o[0]!.kind}`),
      },
    )
    expect(res.outputs[0]!.bytes).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(res.outputs[0]!.mime).toBe('image/png')
    expect(order).toEqual(['submitted T9', 'result url'])
    expect(calls).toEqual([
      'POST https://api-singapore.klingai.com/v1/images/omni-image',
      'GET https://api-singapore.klingai.com/v1/images/omni-image/T9',
      'GET https://cdn.example/out.png',
    ])
  })

  it('sync URL outputs (Qwen-Image, SiliconFlow) are downloaded too', async () => {
    const f = (async (url: string) => {
      if (url.includes('multimodal-generation'))
        return new Response(
          JSON.stringify({
            output: {
              choices: [{ message: { content: [{ image: 'https://oss.example/q.png' }] } }],
            },
          }),
          { status: 200 },
        )
      return new Response(new Uint8Array([9, 9]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      })
    }) as never
    const res = await runGeneration(
      dashscopeImage as MediaProtocol<ImageGenInput>,
      auth('qwen-image-2.0', 'https://ws.cn-beijing.maas.aliyuncs.com'),
      input(),
      { fetch: f },
    )
    expect(res.outputs[0]!.bytes).toEqual(new Uint8Array([9, 9]))
  })
})
