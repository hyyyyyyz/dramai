import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ApiError,
  createClient,
  formatEventId,
  parseEventId,
  routes,
  serverEvent,
  SERVER_EVENT_TYPES,
} from '../src/index.ts'

describe('route contract', () => {
  it('has unique method+path pairs and valid path parameters', () => {
    const seen = new Set<string>()
    for (const [name, r] of Object.entries(routes)) {
      const key = `${r.method} ${r.path}`
      expect(seen.has(key), `${name} duplicates ${key}`).toBe(false)
      seen.add(key)
      expect(r.path.startsWith('/api/'), name).toBe(true)
      if (r.method === 'GET' || r.method === 'DELETE')
        expect(r.body === undefined || r.body === 'multipart', name).toBe(true)
    }
    expect(Object.keys(routes).length).toBeGreaterThan(80)
  })
})

describe('event ids', () => {
  it('round-trips and rejects junk', () => {
    expect(parseEventId(formatEventId('e1', 42))).toEqual({ epoch: 'e1', seq: 42 })
    expect(parseEventId('a:b:7')).toEqual({ epoch: 'a:b', seq: 7 })
    expect(parseEventId('nope')).toBeUndefined()
    expect(parseEventId('x:-1')).toBeUndefined()
    expect(parseEventId(undefined)).toBeUndefined()
  })
  it('every event type has a schema branch', () => {
    const options = serverEvent.options.map((o) => o.shape.type.value).sort()
    expect(options).toEqual([...SERVER_EVENT_TYPES].sort())
  })
})

describe('typed client', () => {
  const fake = (handler: (url: string, init: RequestInit) => Response) => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return handler(url, init)
    }) as unknown as typeof fetch
    return { calls, fetchImpl }
  }

  it('expands and encodes path params, sends the query and a validated JSON body, and adds the token', async () => {
    const { calls, fetchImpl } = fake(
      () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    const client = createClient({ baseUrl: 'http://x/', token: 'tok', fetch: fetchImpl })
    await client.call('shots.delete', { params: { shotId: 'a/b c' } })
    expect(calls[0].url).toBe('http://x/api/shots/a%2Fb%20c')
    expect(calls[0].init.method).toBe('DELETE')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    await expect(
      client.call('projects.create', { body: { name: '', aspectRatio: '9:16' } }),
    ).rejects.toBeInstanceOf(z.ZodError) // 请求体先在客户端校验
  })

  it('turns an error body into ApiError, and validates responses', async () => {
    const { fetchImpl } = fake((url) =>
      url.endsWith('/api/system')
        ? new Response(JSON.stringify({ nope: 1 }), { status: 200 })
        : new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'no such job' } }), {
            status: 404,
          }),
    )
    const client = createClient({ fetch: fetchImpl })
    await expect(client.call('jobs.get', { params: { jobId: 'x' } })).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'no such job',
    })
    await expect(client.call('system.get')).rejects.toBeInstanceOf(z.ZodError)
    const lax = createClient({ fetch: fetchImpl, validate: false })
    await expect(lax.call('system.get')).resolves.toEqual({ nope: 1 })
    expect(ApiError.name).toBe('ApiError')
  })

  it('builds file and export urls', () => {
    const client = createClient({ baseUrl: 'http://h:1' })
    expect(client.fileUrl('p 1', 'images/s/v 1.png')).toBe(
      'http://h:1/api/projects/p%201/files/images/s/v%201.png',
    )
    expect(client.exportUrl('package', 'e1')).toBe('http://h:1/api/episodes/e1/export/package')
  })

  it('sends multipart bodies untouched', async () => {
    const { calls, fetchImpl } = fake(
      () => new Response(JSON.stringify({ bgmId: 'a.wav', bytes: 3 }), { status: 200 }),
    )
    const form = new FormData()
    form.append('file', new Blob(['abc']), 'a.wav')
    await createClient({ fetch: fetchImpl }).call('timeline.uploadBgm', {
      params: { episodeId: 'e' },
      form,
    })
    expect(calls[0].init.body).toBe(form)
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })
})

describe('event stream client', () => {
  const sse = (...chunks: string[]) => {
    const enc = new TextEncoder()
    return new Response(
      new ReadableStream({
        start(c) {
          for (const ch of chunks) c.enqueue(enc.encode(ch))
          c.close()
        },
      }),
      { status: 200 },
    )
  }
  const frame = (id: string, ev: unknown) =>
    `id: ${id}\nevent: ${(ev as { type: string }).type}\ndata: ${JSON.stringify(ev)}\n\n`

  it('parses events, reconnects with Last-Event-ID, and asks for a resync when the epoch changes', async () => {
    const requests: Array<Record<string, string>> = []
    let n = 0
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      requests.push(init.headers as Record<string, string>)
      n++
      if (n === 1)
        return sse(
          frame('A:1', { type: 'hello', epoch: 'A', serverTime: 1 }),
          frame('A:2', { type: 'job.progress', jobId: 'j', progress: 0.5 }),
          ': ping\n\n',
        )
      if (n === 2) return sse(frame('B:1', { type: 'hello', epoch: 'B', serverTime: 2 }))
      return new Promise<Response>(() => {}) // 之后一直挂着
    }) as unknown as typeof fetch
    const events: string[] = []
    const resyncs: string[] = []
    const conn = createClient({ fetch: fetchImpl }).connectEvents({
      onEvent: (e) => events.push(e.type),
      onResync: (r) => resyncs.push(r),
      retry: { initialMs: 1, maxMs: 2 },
    })
    await new Promise((r) => setTimeout(r, 80))
    conn.close()
    expect(events).toEqual(['hello', 'job.progress', 'hello'])
    expect(requests[0]['Last-Event-ID']).toBeUndefined()
    expect(requests[1]['Last-Event-ID']).toBe('A:2')
    expect(resyncs).toEqual(['epoch_changed'])
  })

  it('forwards a server resync notice and ignores malformed frames', async () => {
    const fetchImpl = (async () =>
      sse(
        'event: x\ndata: {bad json\n\n',
        frame('A:1', { type: 'hello', epoch: 'A', serverTime: 1 }),
        frame('A:5', { type: 'resync', reason: 'buffer_overflow' }),
      )) as unknown as typeof fetch
    const events: string[] = []
    const resyncs: string[] = []
    const conn = createClient({ fetch: fetchImpl }).connectEvents({
      onEvent: (e) => events.push(e.type),
      onResync: (r) => resyncs.push(r),
      retry: { initialMs: 5000 },
    })
    await new Promise((r) => setTimeout(r, 40))
    conn.close()
    expect(events).toEqual(['hello', 'resync'])
    expect(resyncs).toEqual(['buffer_overflow'])
  })
})

describe('frontend gap contract additions', () => {
  it('has the new routes with the shapes the frontend relies on', async () => {
    const { routes } = await import('../src/index.ts')
    expect(routes['episodes.create']).toMatchObject({
      method: 'POST',
      path: '/api/projects/:projectId/episodes',
    })
    expect(routes['projects.setStyleReference']).toMatchObject({
      method: 'POST',
      body: 'multipart',
    })
    expect(routes['jobs.ignoreResult']).toMatchObject({
      method: 'POST',
      path: '/api/jobs/:jobId/ignore-result',
    })
  })

  it('styleChoice accepts reference_image; jobTarget is a closed set of structured kinds', async () => {
    const { styleChoice, jobTarget } = await import('../src/index.ts')
    expect(styleChoice.parse({ source: 'reference_image' })).toEqual({ source: 'reference_image' })
    expect(styleChoice.parse({ source: 'reference_image', label: '我的' })).toMatchObject({
      label: '我的',
    })
    for (const t of [
      {
        kind: 'shot',
        shotId: 's',
        shotIndex: 1,
        shotNumber: 3,
        sceneId: 'sc',
        episodeId: 'e',
        episodeNumber: 1,
        episodeTitle: '一',
      },
      { kind: 'asset', assetId: 'a', assetKind: 'character', name: '林夏', variantName: '冬装' },
      { kind: 'episode', episodeId: 'e', episodeNumber: 1, episodeTitle: '一' },
      { kind: 'project' },
      { kind: 'removed', entity: 'shot', id: 's' },
    ]) {
      expect(jobTarget.parse(t)).toEqual(t)
    }
    expect(jobTarget.safeParse({ kind: 'sentence', text: '生成分镜图' }).success).toBe(false)
  })

  it('the new error codes are documented', async () => {
    const { ERROR_CODES } = await import('../src/index.ts')
    for (const code of ['STYLE_REFERENCE_MISSING', 'NOT_RUNNING', 'NOT_APPLICABLE'] as const) {
      expect(ERROR_CODES[code].status).toBeGreaterThanOrEqual(400)
    }
  })

  it('the client sends the locale header', async () => {
    const { createClient } = await import('../src/index.ts')
    let seen: Headers | undefined
    const client = createClient({
      baseUrl: 'http://x',
      locale: 'en',
      validate: false,
      fetch: (async (_url: unknown, init?: RequestInit) => {
        seen = new Headers(init?.headers)
        return new Response(JSON.stringify({ groups: [] }), {
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof fetch,
    })
    await client.call('styles.list')
    expect(seen?.get('x-dramai-locale')).toBe('en')
  })
})

describe('protected request headers', () => {
  it('are exported from the contract, lower case, without duplicates', async () => {
    const { PROTECTED_REQUEST_HEADERS } = await import('../src/index.ts')
    expect(PROTECTED_REQUEST_HEADERS).toContain('authorization')
    expect(PROTECTED_REQUEST_HEADERS).toContain('content-type')
    expect(PROTECTED_REQUEST_HEADERS.every((h) => h === h.toLowerCase())).toBe(true)
    expect(new Set(PROTECTED_REQUEST_HEADERS).size).toBe(PROTECTED_REQUEST_HEADERS.length)
  })
})

describe('timeline revision reason: a client built before a new value existed still reads the revision', () => {
  it('accepts the known values and any other string; the known list is exported', async () => {
    const { timelineRevision, timelineRevisionReason, TIMELINE_REVISION_REASONS_KNOWN } =
      await import('../src/index.ts')
    const base = {
      number: 2,
      author: { kind: 'agent' },
      summary: 'x',
      createdAt: 1,
      content: { clips: [], bgm: [] },
    }
    for (const reason of [...TIMELINE_REVISION_REASONS_KNOWN, 'some_future_reason'])
      expect(timelineRevision.safeParse({ ...base, reason }).success, reason).toBe(true)
    expect(timelineRevision.safeParse(base).success).toBe(true) // old revisions have none
    expect(timelineRevisionReason.safeParse(5).success).toBe(false) // still a string
    expect(TIMELINE_REVISION_REASONS_KNOWN).toEqual([
      'native_audio_default',
      'initial',
      'sync_shots',
      'rollback',
    ])
  })
})

describe('revision author kind: known values or any string', () => {
  it('a client built before a new kind existed still reads the revision', async () => {
    const { timelineRevision, REVISION_AUTHOR_KINDS_KNOWN } = await import('../src/index.ts')
    const base = { number: 2, summary: 'x', createdAt: 1, content: { clips: [], bgm: [] } }
    expect([...REVISION_AUTHOR_KINDS_KNOWN]).toEqual(['creator', 'system', 'agent', 'external'])
    for (const kind of [...REVISION_AUTHOR_KINDS_KNOWN, 'some_future_kind'])
      expect(timelineRevision.safeParse({ ...base, author: { kind } }).success, kind).toBe(true)
    expect(timelineRevision.safeParse({ ...base, author: { kind: 5 } }).success).toBe(false)
  })
})

describe('narrationVoice in the contract is never stricter than what a provider declares', () => {
  it('a style instruction of 4096 characters (OpenAI) and much more is accepted; only an absurd length is refused', async () => {
    const { projectUpdate, projectCreate } = await import('../src/index.ts')
    const voice = (instructions: string) => ({
      providerConfigId: 'p',
      voice: 'v',
      speed: 4,
      language: 'fil',
      instructions,
    })
    for (const n of [1, 1000, 1001, 4096, 8000, 20000]) {
      expect(
        projectUpdate.safeParse({ narrationVoice: voice('a'.repeat(n)) }).success,
        String(n),
      ).toBe(true)
      expect(
        projectCreate.safeParse({
          name: 'x',
          aspectRatio: '9:16',
          narrationVoice: voice('字'.repeat(n)),
        }).success,
        String(n),
      ).toBe(true)
    }
    expect(projectUpdate.safeParse({ narrationVoice: voice('a'.repeat(20001)) }).success).toBe(
      false,
    )
  })

  it('the voice name has no length limit of its own (SiliconFlow addresses and MiniMax ids are long)', async () => {
    const { projectUpdate } = await import('../src/index.ts')
    const long = `speech:${'x'.repeat(300)}:abc:def`
    expect(
      projectUpdate.safeParse({ narrationVoice: { providerConfigId: 'p', voice: long } }).success,
    ).toBe(true)
  })
})
