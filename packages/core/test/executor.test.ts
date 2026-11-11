import { describe, expect, it } from 'vitest'
import { ProviderError, toJobError } from '../src/providers/errors.ts'
import { downloadOutput, runGeneration, sendRequest } from '../src/providers/executor.ts'
import type { FetchLike } from '../src/providers/executor.ts'
import { aliyunVideo, openaiImages, openaiTts } from '../src/providers/protocols/index.ts'
import { chatOnce, streamChat } from '../src/providers/llm.ts'
import { testProvider } from '../src/providers/test-connection.ts'

const auth = { baseUrl: 'https://api.example.com', model: 'wan2.2-i2v-flash', apiKey: 'sk-secret' }
const image = { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }
const noSleep = async () => {}

type Step = Response | Error | ((url: string, init?: RequestInit) => Response | Promise<Response>)

/** 按顺序回放响应的假 fetch，并记录每次请求。 */
function scripted(steps: Step[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init })
    const step = steps[Math.min(calls.length - 1, steps.length - 1)]
    if (step instanceof Error) throw step
    return typeof step === 'function' ? step(url, init) : step.clone()
  }
  return { fetch, calls }
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const text = (body: string, status = 200) => new Response(body, { status })
const bytes = (b: number[], mime = 'video/mp4') =>
  new Response(new Uint8Array(b), { status: 200, headers: { 'content-type': mime } })

const submitOk = json({ output: { task_id: 'task-1', task_status: 'PENDING' } })
const pollRunning = json({ output: { task_status: 'RUNNING' } })
const pollDone = json({
  output: { task_status: 'SUCCEEDED', video_url: 'https://cdn.example.com/v.mp4' },
})

const videoInput = { prompt: 'p', image, durationSec: 5 }

async function failure<T>(p: Promise<T>): Promise<ProviderError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(ProviderError)
    return e as ProviderError
  }
  throw new Error('expected a failure')
}

describe('runGeneration: async protocol happy path', () => {
  it('submits, polls, downloads, and checkpoints the task id before polling', async () => {
    const events: string[] = []
    const { fetch, calls } = scripted([submitOk, pollRunning, pollDone, bytes([7, 7, 7])])
    const result = await runGeneration(
      aliyunVideo,
      auth,
      videoInput,
      { fetch, sleep: noSleep },
      {
        onSubmitted: (id) => void events.push(`submitted:${id}:calls=${calls.length}`),
        onPoll: (s) => void events.push(`poll:${s.status}`),
        onResult: (o) => void events.push(`result:${o.length}`),
      },
    )
    expect(result.taskId).toBe('task-1')
    expect(result.outputs[0].bytes).toEqual(new Uint8Array([7, 7, 7]))
    expect(result.outputs[0].mime).toBe('video/mp4')
    // 任务号在第一次轮询之前就已交给调用方（此时只发过 1 次请求）
    expect(events).toEqual([
      'submitted:task-1:calls=1',
      'poll:processing',
      'poll:completed',
      'result:1',
    ])
    expect(calls.map((c) => c.init?.method)).toEqual(['POST', 'GET', 'GET', 'GET'])
    expect(calls[0].init?.headers).toMatchObject({ Authorization: 'Bearer sk-secret' })
  })

  it('resumes from a task id without submitting again', async () => {
    const { fetch, calls } = scripted([pollDone, bytes([1])])
    await runGeneration(
      aliyunVideo,
      auth,
      videoInput,
      { fetch, sleep: noSleep },
      { resumeTaskId: 'task-9' },
    )
    expect(calls[0].url).toContain('/aliyun/api/v1/tasks/task-9')
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false)
  })

  it('resumes from a known result URL: only downloads', async () => {
    const { fetch, calls } = scripted([bytes([4, 5])])
    const result = await runGeneration(
      aliyunVideo,
      auth,
      videoInput,
      { fetch, sleep: noSleep },
      {
        resumeOutputs: [{ kind: 'url', url: 'https://cdn.example.com/x.mp4' }],
      },
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://cdn.example.com/x.mp4')
    expect(result.outputs[0].bytes).toEqual(new Uint8Array([4, 5]))
  })

  it('does not download when asked not to', async () => {
    const { fetch, calls } = scripted([submitOk, pollDone])
    const result = await runGeneration(
      aliyunVideo,
      auth,
      videoInput,
      { fetch, sleep: noSleep },
      { download: false },
    )
    expect(calls).toHaveLength(2)
    expect(result.outputs[0].sourceUrl).toBe('https://cdn.example.com/v.mp4')
  })
})

describe('runGeneration: sync protocols', () => {
  it('returns inline images without polling', async () => {
    const { fetch, calls } = scripted([
      json({ data: [{ b64_json: Buffer.from([1, 2]).toString('base64') }] }),
    ])
    const result = await runGeneration(openaiImages, auth, { prompt: 'x' }, { fetch })
    expect(calls).toHaveLength(1)
    expect(result.outputs[0].bytes).toEqual(new Uint8Array([1, 2]))
  })

  it('reads binary TTS responses', async () => {
    const { fetch } = scripted([
      new Response(new Uint8Array([9, 9]), { headers: { 'content-type': 'audio/mpeg' } }),
    ])
    const result = await runGeneration(openaiTts, auth, { text: 'hi' }, { fetch })
    expect(result.outputs[0]).toMatchObject({ bytes: new Uint8Array([9, 9]), mime: 'audio/mpeg' })
  })

  it('downloads URL outputs of sync protocols', async () => {
    const { fetch, calls } = scripted([
      json({ data: [{ url: 'https://img/x.png' }] }),
      bytes([5], 'image/png'),
    ])
    const result = await runGeneration(openaiImages, auth, { prompt: 'x' }, { fetch })
    expect(calls[1].url).toBe('https://img/x.png')
    expect(result.outputs[0].mime).toBe('image/png')
  })
})

describe('runGeneration: submission outcomes (what may have been charged)', () => {
  it('4xx on submit = rejected: nothing was created', async () => {
    const { fetch } = scripted([json({ error: 'bad key' }, 401)])
    const err = await failure(runGeneration(aliyunVideo, auth, videoInput, { fetch }))
    expect(err.kind).toBe('http')
    expect(err.status).toBe(401)
    expect(err.submission).toBe('rejected')
    expect(toJobError(err).category).toBe('generation_failed')
  })

  it('5xx on submit = unknown outcome', async () => {
    const { fetch } = scripted([text('boom', 502)])
    const err = await failure(runGeneration(aliyunVideo, auth, videoInput, { fetch }))
    expect(err.submission).toBe('unknown')
    expect(toJobError(err)).toMatchObject({ category: 'submission_unknown', recoverable: false })
  })

  it('network error on submit = unknown outcome (the request may have arrived)', async () => {
    const { fetch } = scripted([new TypeError('fetch failed')])
    const err = await failure(runGeneration(aliyunVideo, auth, videoInput, { fetch }))
    expect(err.kind).toBe('network')
    expect(err.submission).toBe('unknown')
  })

  it('2xx with an unreadable body = unknown outcome', async () => {
    const { fetch } = scripted([json({ output: {} })])
    const err = await failure(runGeneration(aliyunVideo, auth, videoInput, { fetch }))
    expect(err.kind).toBe('parse')
    expect(err.submission).toBe('unknown')
  })

  it('never reports the API key in an error message', async () => {
    const { fetch } = scripted([text('invalid key sk-secret', 401)])
    const err = await failure(runGeneration(aliyunVideo, auth, videoInput, { fetch }))
    // 响应体片段会带回上游文本；适配器自己不拼接 key
    expect(err.message.replace(/invalid key sk-secret/g, '')).not.toContain('sk-secret')
  })

  it('cancelled before submit', async () => {
    const ac = new AbortController()
    ac.abort()
    const { fetch } = scripted([submitOk])
    const err = await failure(
      runGeneration(aliyunVideo, auth, videoInput, { fetch }, { signal: ac.signal }),
    )
    expect(err.kind).toBe('cancelled')
  })
})

describe('runGeneration: polling failures', () => {
  it('tolerates transient poll errors and keeps polling', async () => {
    const { fetch, calls } = scripted([
      submitOk,
      text('x', 500),
      new TypeError('net'),
      pollRunning,
      pollDone,
      bytes([1]),
    ])
    const result = await runGeneration(aliyunVideo, auth, videoInput, { fetch, sleep: noSleep })
    expect(result.outputs).toHaveLength(1)
    expect(calls).toHaveLength(6)
  })

  it('gives up after N consecutive poll errors: delivery_failed, recoverable', async () => {
    const { fetch } = scripted([submitOk, text('x', 503)])
    const err = await failure(
      runGeneration(
        aliyunVideo,
        auth,
        videoInput,
        { fetch, sleep: noSleep },
        { poll: { intervalMs: 1, maxAttempts: 50, maxConsecutiveErrors: 3 } },
      ),
    )
    expect(err.kind).toBe('poll_failed')
    expect(err.recoverable).toBe(true)
    expect(toJobError(err)).toMatchObject({ category: 'delivery_failed', recoverable: true })
  })

  it('resets the consecutive-error counter after a good poll', async () => {
    const { fetch } = scripted([
      submitOk,
      text('x', 500),
      text('x', 500),
      pollRunning,
      text('x', 500),
      text('x', 500),
      pollDone,
      bytes([1]),
    ])
    const result = await runGeneration(
      aliyunVideo,
      auth,
      videoInput,
      { fetch, sleep: noSleep },
      { poll: { intervalMs: 1, maxAttempts: 20, maxConsecutiveErrors: 3 } },
    )
    expect(result.outputs).toHaveLength(1)
  })

  it('times out after max attempts: delivery_failed, recoverable', async () => {
    const { fetch } = scripted([submitOk, pollRunning])
    const err = await failure(
      runGeneration(
        aliyunVideo,
        auth,
        videoInput,
        { fetch, sleep: noSleep },
        { poll: { intervalMs: 1, maxAttempts: 4 } },
      ),
    )
    expect(err.kind).toBe('poll_timeout')
    expect(toJobError(err).category).toBe('delivery_failed')
  })

  it('upstream-confirmed failure is generation_failed and not recoverable', async () => {
    const { fetch } = scripted([
      submitOk,
      json({ output: { task_status: 'FAILED', message: 'content policy' } }),
    ])
    const err = await failure(
      runGeneration(aliyunVideo, auth, videoInput, { fetch, sleep: noSleep }),
    )
    expect(err.kind).toBe('upstream_failed')
    expect(err.message).toBe('content policy')
    expect(toJobError(err)).toMatchObject({ category: 'generation_failed', recoverable: false })
  })

  it('a 404 on poll is fatal and not recoverable; a 401 is recoverable (fix the key)', async () => {
    const e404 = await failure(
      runGeneration(aliyunVideo, auth, videoInput, {
        fetch: scripted([submitOk, text('gone', 404)]).fetch,
        sleep: noSleep,
      }),
    )
    expect(e404).toMatchObject({ kind: 'http', status: 404, recoverable: false })
    const e401 = await failure(
      runGeneration(aliyunVideo, auth, videoInput, {
        fetch: scripted([submitOk, text('no', 401)]).fetch,
        sleep: noSleep,
      }),
    )
    expect(e401).toMatchObject({ kind: 'http', status: 401, recoverable: true })
  })

  it('cancelling during polling stops it', async () => {
    const ac = new AbortController()
    const { fetch } = scripted([submitOk, pollRunning])
    const err = await failure(
      runGeneration(
        aliyunVideo,
        auth,
        videoInput,
        { fetch, sleep: async () => ac.abort() },
        { signal: ac.signal },
      ),
    )
    expect(err.kind).toBe('cancelled')
  })
})

describe('downloadOutput', () => {
  it('retries and then succeeds', async () => {
    const { fetch, calls } = scripted([text('x', 500), bytes([1, 2])])
    const out = await downloadOutput({ kind: 'url', url: 'https://x/y' }, { fetch, sleep: noSleep })
    expect(out.bytes).toEqual(new Uint8Array([1, 2]))
    expect(calls).toHaveLength(2)
  })

  it('fails as download_failed (recoverable) when retries run out', async () => {
    const { fetch, calls } = scripted([text('x', 403)])
    const err = await failure(
      downloadOutput({ kind: 'url', url: 'https://x/y' }, { fetch, sleep: noSleep }, {
        retries: 1,
      } as never),
    )
    expect(err.kind).toBe('download_failed')
    expect(err.recoverable).toBe(true)
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })

  it('passes bytes outputs straight through', async () => {
    const out = await downloadOutput(
      { kind: 'bytes', bytes: new Uint8Array([3]), mime: 'image/png' },
      {},
    )
    expect(out).toEqual({ bytes: new Uint8Array([3]), mime: 'image/png' })
  })
})

describe('sendRequest', () => {
  it('sends form bodies without a JSON content type', async () => {
    const { fetch, calls } = scripted([json({})])
    const form = new FormData()
    form.append('a', 'b')
    await sendRequest(
      { method: 'POST', url: 'https://x', headers: {}, body: { type: 'form', value: form } },
      { fetch },
    )
    expect(calls[0].init?.body).toBe(form)
    expect((calls[0].init?.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('times out slow requests as a network error', async () => {
    const fetch: FetchLike = (_u, init) =>
      new Promise((_r, reject) =>
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)),
      )
    const err = await failure(
      sendRequest({ method: 'GET', url: 'https://x', headers: {} }, { fetch }, { timeoutMs: 10 }),
    )
    expect(err.kind).toBe('network')
    expect(err.code).toBe('TIMEOUT')
  })
})

describe('streamChat', () => {
  const sse = (...events: string[]) =>
    new Response(events.map((e) => `data: ${e}\n\n`).join(''), { status: 200 })
  const chat = { messages: [{ role: 'user' as const, content: 'hi' }] }

  it('streams deltas with accumulated text and returns the final result', async () => {
    const { fetch, calls } = scripted([
      sse(
        '{"choices":[{"delta":{"content":"he"}}]}',
        '{"choices":[{"delta":{"content":"llo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}',
        '[DONE]',
      ),
    ])
    const seen: string[] = []
    const it = streamChat({ ...auth, model: 'deepseek-chat' }, chat, { fetch })
    let step = await it.next()
    while (!step.done) {
      seen.push(step.value.accumulated)
      step = await it.next()
    }
    expect(seen).toEqual(['he', 'hello'])
    expect(step.value).toEqual({
      text: 'hello',
      finishReason: 'stop',
      usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
    })
    expect(JSON.parse(calls[0].init?.body as string)).toMatchObject({
      model: 'deepseek-chat',
      stream: true,
    })
  })

  it('chatOnce collects the text', async () => {
    const { fetch } = scripted([sse('{"choices":[{"delta":{"content":"ok"}}]}')])
    expect((await chatOnce(auth, chat, { fetch })).text).toBe('ok')
  })

  it('maps HTTP errors with a body snippet', async () => {
    const { fetch } = scripted([text('rate limited', 429)])
    const err = await failure(chatOnce(auth, chat, { fetch }))
    expect(err).toMatchObject({ kind: 'http', status: 429 })
    expect(err.message).toContain('rate limited')
  })

  it('maps network errors and cancellation', async () => {
    const e1 = await failure(
      chatOnce(auth, chat, { fetch: scripted([new TypeError('down')]).fetch }),
    )
    expect(e1.kind).toBe('network')
    const ac = new AbortController()
    ac.abort()
    const e2 = await failure(
      chatOnce(auth, chat, {
        fetch: scripted([new DOMException('x', 'AbortError')]).fetch,
        signal: ac.signal,
      }),
    )
    expect(e2.kind).toBe('cancelled')
  })
})

describe('testProvider (ok / failed / unverifiable)', () => {
  it('lists models on OpenAI-compatible endpoints', async () => {
    const { fetch, calls } = scripted([json({ data: [{ id: 'deepseek-chat' }, { id: 'other' }] })])
    const r = await testProvider(
      { baseUrl: 'https://api.deepseek.com', protocol: 'openai-chat', model: 'deepseek-chat' },
      'k',
      { fetch },
    )
    expect(r).toMatchObject({ outcome: 'ok', modelCount: 2, modelListed: true })
    expect(calls[0].url).toBe('https://api.deepseek.com/models')
  })

  it('uses the v1beta list for Gemini and strips the models/ prefix', async () => {
    const { fetch, calls } = scripted([
      json({ models: [{ name: 'models/gemini-2.5-flash-image' }] }),
    ])
    const r = await testProvider(
      { baseUrl: 'https://api.302.ai', protocol: 'gemini-image', model: 'gemini-2.5-flash-image' },
      'k',
      { fetch },
    )
    expect(r).toMatchObject({ outcome: 'ok', modelListed: true })
    expect(calls[0].url).toBe('https://api.302.ai/v1beta/models')
  })

  it('reports HTTP failures and network failures as failed', async () => {
    const r1 = await testProvider(
      { baseUrl: 'https://x', protocol: 'openai-chat', model: 'm' },
      'k',
      { fetch: scripted([text('nope', 401)]).fetch },
    )
    expect(r1).toMatchObject({ outcome: 'failed', status: 401 })
    const r2 = await testProvider(
      { baseUrl: 'https://x', protocol: 'openai-chat', model: 'm' },
      'k',
      { fetch: scripted([new TypeError('dns')]).fetch },
    )
    expect(r2.outcome).toBe('failed')
    const r3 = await testProvider({ baseUrl: ' ', protocol: 'openai-chat', model: 'm' }, 'k')
    expect(r3).toMatchObject({ outcome: 'failed' })
  })

  it.each(['aliyun-video', 'volcengine-video', 'kling-video', 'generic-video'] as const)(
    'cannot verify %s without generating — and does not call the network',
    async (protocol) => {
      const { fetch, calls } = scripted([json({})])
      const r = await testProvider({ baseUrl: 'https://x', protocol, model: 'm' }, 'k', { fetch })
      expect(r.outcome).toBe('unverifiable')
      expect(calls).toHaveLength(0)
    },
  )
})
