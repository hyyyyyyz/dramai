import { connect } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadCatalog, locateFfmpeg, probeMedia, parseSseJson } from '@dramai/core'
import { afterEach, describe, expect, it } from 'vitest'
import { startMockProviders } from '../src/index.ts'
import type { MockProviders } from '../src/index.ts'
import { detectTask } from '../src/llm/tasks.ts'
import { pngSize } from '../src/media/png.ts'

const live: MockProviders[] = []
afterEach(async () => {
  for (const m of live.splice(0)) await m.close()
})
const start = async (config = {}) => {
  const m = await startMockProviders({ config: { videoMs: 200, ...config } })
  live.push(m)
  return m
}
const post = (
  m: MockProviders,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  fetch(m.url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

function rawHost(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = connect(port, '127.0.0.1')
    let data = ''
    s.on('data', (d) => (data += d.toString()))
    s.on('error', reject)
    s.on('close', () => resolve(Number(/HTTP\/1\.1 (\d+)/.exec(data)?.[1])))
    s.write(`GET /v1/models HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`)
  })
}

describe('the mock answers real protocols', () => {
  it('only listens on loopback and only answers loopback Host headers', async () => {
    const m = await start()
    expect(m.host).toBe('127.0.0.1')
    expect(await rawHost(m.port, `127.0.0.1:${m.port}`)).toBe(200)
    expect(await rawHost(m.port, 'evil.example.com')).toBe(403)
  })

  it('every real system prompt is recognised as its pipeline step', () => {
    const { prompts } = loadCatalog()
    const vars = {
      targetChars: '2500',
      aspectRatio: '9:16',
      styleLabel: '写实',
      aspectHint: '竖屏',
      targetShotsMin: '4',
      targetShotsMax: '8',
    }
    const render = (id: string) => prompts.render(id, vars)
    const expected: Record<string, string> = {
      'episodes.plan.system': 'episodes.plan',
      'shots.breakdown.system': 'shots.breakdown',
      'entities.extract.system': 'entities.extract',
      'entities.merge.system': 'entities.merge',
      'entities.variants.system': 'entities.variants',
      'shots.frames.system': 'shots.frames',
    }
    for (const [id, task] of Object.entries(expected)) {
      expect(
        detectTask([
          { role: 'system', content: render(id) },
          { role: 'user', content: 'x' },
        ]),
        id,
      ).toBe(task)
    }
  })

  it('chat completions stream chunks and finish with [DONE]; non-pipeline chat gets a plain reply', async () => {
    const m = await start({ streamChunkMs: 0 })
    const res = await post(m, '/chat/completions', {
      model: 'deepseek-chat',
      stream: true,
      messages: [{ role: 'user', content: '你好' }],
    })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    let text = ''
    let chunks = 0
    for await (const frame of parseSseJson(res.body!)) {
      const delta = (frame.data as { choices?: Array<{ delta?: { content?: string } }> })
        .choices?.[0]?.delta?.content
      if (delta) {
        text += delta
        chunks++
      }
    }
    expect(chunks).toBeGreaterThan(1)
    expect(text).toContain('模拟')
  })

  it('/models answers on both /models and /v1/models and the Gemini list path (test connection)', async () => {
    const m = await start()
    for (const p of ['/models', '/v1/models', '/v1beta/models'])
      expect((await fetch(m.url + p)).status, p).toBe(200)
  })

  it('Gemini image: PNG sized to the requested aspect ratio', async () => {
    const m = await start()
    for (const [ratio, wide] of [
      ['9:16', false],
      ['16:9', true],
      ['1:1', undefined],
    ] as const) {
      const res = await post(m, '/v1beta/models/gemini-2.5-flash-image:generateContent', {
        contents: [{ parts: [{ text: '一个镜头' }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ratio } },
      })
      const json = (await res.json()) as {
        candidates: Array<{ content: { parts: Array<{ inline_data: { data: string } }> } }>
      }
      const png = new Uint8Array(
        Buffer.from(json.candidates[0]!.content.parts[0]!.inline_data.data, 'base64'),
      )
      const size = pngSize(png)!
      if (wide === undefined) expect(size.width).toBe(size.height)
      else expect(size.width > size.height).toBe(wide)
    }
  })

  it('OpenAI images: honours the requested size; different prompts give different pictures', async () => {
    const m = await start()
    const get = async (prompt: string) => {
      const res = await post(m, '/images/generations', {
        prompt,
        size: '512x896',
        response_format: 'b64_json',
      })
      const j = (await res.json()) as { data: Array<{ b64_json: string }> }
      return new Uint8Array(Buffer.from(j.data[0]!.b64_json, 'base64'))
    }
    const a = await get('甲')
    const b = await get('乙')
    expect(pngSize(a)).toEqual({ width: 512, height: 896 })
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })

  it('TTS: audio length follows text length and speed', async () => {
    const m = await start()
    const seconds = async (input: string, speed?: number) => {
      const res = await post(m, '/audio/speech', { model: 'tts-1', input, voice: 'alloy', speed })
      expect(res.headers.get('content-type')).toBe('audio/wav')
      const bytes = new Uint8Array(await res.arrayBuffer())
      return (bytes.byteLength - 44) / 2 / 16000
    }
    const short = await seconds('你好。')
    const long = await seconds('这是一段明显更长的话，说起来需要的时间自然也长得多。'.repeat(2))
    expect(long).toBeGreaterThan(short * 4)
    expect(await seconds('这是一段明显更长的话，说起来需要的时间自然也长得多。', 2)).toBeLessThan(
      await seconds('这是一段明显更长的话，说起来需要的时间自然也长得多。', 1),
    )
  })

  it('image-to-video (Aliyun protocol): async task, polling, then a real mp4 of the requested length', async () => {
    const m = await start({ videoMs: 150 })
    const bins = await locateFfmpeg().catch(() => undefined)
    if (!bins) return // 没有 ffmpeg 的机器：视频被明确拒绝，见下一条
    const img = await post(m, '/v1beta/models/x:generateContent', {
      generationConfig: { imageConfig: { aspectRatio: '9:16' } },
      contents: [{ parts: [{ text: 'p' }] }],
    })
    const png = (
      (await img.json()) as {
        candidates: Array<{ content: { parts: Array<{ inline_data: { data: string } }> } }>
      }
    ).candidates[0]!.content.parts[0]!.inline_data.data
    const submit = await post(m, '/aliyun/api/v1/services/aigc/video-generation/video-synthesis', {
      model: 'wan2.2-i2v-flash',
      input: { prompt: 'x', img_url: `data:image/png;base64,${png}` },
      parameters: { duration: 3, resolution: '720P' },
    })
    const taskId = ((await submit.json()) as { output: { task_id: string } }).output.task_id
    const seen = new Set<string>()
    let url = ''
    for (let i = 0; i < 100 && !url; i++) {
      const poll = (await (await fetch(`${m.url}/aliyun/api/v1/tasks/${taskId}`)).json()) as {
        output: { task_status: string; video_url?: string }
      }
      seen.add(poll.output.task_status)
      if (poll.output.video_url) url = poll.output.video_url
      else await new Promise((r) => setTimeout(r, 20))
    }
    expect(url).toContain('/media/')
    expect([...seen]).toContain('PENDING')
    expect(seen.has('SUCCEEDED')).toBe(true)
    const dir = await mkdtemp(join(tmpdir(), 'mock-vid-'))
    try {
      const file = join(dir, 'v.mp4')
      await writeFile(file, new Uint8Array(await (await fetch(url)).arrayBuffer()))
      const info = await probeMedia(bins, file)
      expect(info.hasVideo).toBe(true)
      expect(info.durationSec).toBeGreaterThan(2.5)
      expect(info.durationSec).toBeLessThan(3.5)
      expect(info.height! > info.width!).toBe(true) // 竖屏起始帧 → 竖屏视频
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
    }
  })
})

describe('control plane', () => {
  it('latency is configurable at runtime', async () => {
    const m = await start()
    const t0 = Date.now()
    await fetch(m.url + '/models')
    const fast = Date.now() - t0
    // /models 不加延迟；用 TTS 验证
    m.configure({ latencyMs: 150 })
    const t1 = Date.now()
    await post(m, '/audio/speech', { input: '你好' })
    expect(Date.now() - t1).toBeGreaterThanOrEqual(140)
    expect(fast).toBeLessThan(150)
    const put = await fetch(m.url + '/__mock/config', {
      method: 'PUT',
      body: JSON.stringify({ latencyMs: 0 }),
    })
    expect((await put.json()) as { config: { latencyMs: number } }).toMatchObject({
      config: { latencyMs: 0 },
    })
  })

  it('a request can ask for its own failure: header or [[mock:xxx]] in the prompt', async () => {
    const m = await start()
    expect(
      (await post(m, '/audio/speech', { input: '你好' }, { 'x-mock-fault': 'rate_limit' })).status,
    ).toBe(429)
    expect((await post(m, '/audio/speech', { input: '你好 [[mock:server_error]]' })).status).toBe(
      500,
    )
    expect((await post(m, '/audio/speech', { input: '你好' })).status).toBe(200)
  })

  it('rules: nth / every / times / promptIncludes, and failure rate is reproducible from the seed', async () => {
    const m = await start()
    m.addRule({ fault: 'reject', on: 'tts', nth: 2 })
    m.addRule({ fault: 'rate_limit', on: 'image', promptIncludes: '触发限流', times: 1 })
    const tts = async () => (await post(m, '/audio/speech', { input: '好' })).status
    expect([await tts(), await tts(), await tts()]).toEqual([200, 400, 200])
    const img = (p: string) =>
      post(m, '/images/generations', { prompt: p, size: '64x64' }).then((r) => r.status)
    expect([await img('普通'), await img('请触发限流'), await img('请触发限流')]).toEqual([
      200, 429, 200,
    ])

    const outcomes = async (seed: number) => {
      const n = await start({
        failureRate: 0.5,
        failureKinds: ['server_error'],
        failureOn: ['tts'],
        seed,
      })
      const out: number[] = []
      for (let i = 0; i < 12; i++)
        out.push((await post(n, '/audio/speech', { input: '好' })).status)
      return out
    }
    const a = await outcomes(7)
    expect(await outcomes(7)).toEqual(a)
    expect(a).toContain(500)
    expect(a).toContain(200)
  })
})
