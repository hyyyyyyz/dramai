import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@dramai/api'
import type { ProviderKind } from '@dramai/core'
import { createServer } from '@dramai/server'
import type { DramaiServer } from '@dramai/server'
import { startMockProviders } from '../src/index.ts'
import type { MockProviders } from '../src/index.ts'

/**
 * `providers.probe` against a real local server and the mock's real HTTP: the upstream shapes a draft meets before it is
 * saved (a normal list, 401, a redirect to another origin, a body that is not JSON, an error that echoes the key).
 * Every outcome is compared with `providers.test` / `providers.models` on the same configuration saved first.
 */
const KEY = 'sk-probe-0123456789abcdef'
let mock: MockProviders
let server: DramaiServer
let api: ReturnType<typeof createClient>
let dataDir: string

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'dramai-mock-probe-'))
  mock = await startMockProviders()
  server = await createServer({
    dataDir,
    port: 0,
    validateResponses: true,
    logger: { error: () => {} },
  })
  api = createClient({ baseUrl: server.url })
}, 60_000)

afterAll(async () => {
  await server?.close({ graceful: false })
  await mock?.close()
  await rm(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
})

const draft = (shape: string, protocol = 'openai-chat', kind = 'llm' as ProviderKind) => ({
  kind,
  protocol: protocol as never,
  baseUrl: `${mock.url}/probe/${shape}/v1`,
  model: 'probe-model',
})
const probe = (d: ReturnType<typeof draft>, action: 'models' | 'test') =>
  api.call('providers.probe', {
    body: { action, ...d, auth: { type: 'api_key', apiKey: KEY } },
  })
const strip = (l: MockProviders['requests']) =>
  l.map((r) => ({ method: r.method, path: r.path, status: r.status, headers: r.headers }))

describe('upstream shapes: probe and a saved provider see and do the same', () => {
  it.each(['internal', 'unauthorized', 'redirect', 'not-json', 'echo-key'])(
    '%s · test connection',
    async (shape) => {
      const d = draft(shape)
      const saved = await api.call('providers.create', {
        body: { label: shape, ...d, apiKey: KEY, auth: { type: 'api_key' } },
      })
      const from = mock.requests.length
      const savedResult = await api.call('providers.test', { params: { providerId: saved.id } })
      const savedLog = mock.requests.slice(from)
      const mid = mock.requests.length
      const probeResult = await probe(d, 'test')
      const probeLog = mock.requests.slice(mid)
      // the same requests reached the mock, with the same headers
      expect(strip(probeLog)).toEqual(strip(savedLog))
      if (shape === 'echo-key') {
        // the only difference: the saved test shows what the upstream said; the draft's answer never carries the key
        expect(JSON.stringify(probeResult)).not.toContain(KEY)
        expect(probeResult).toMatchObject({ outcome: 'failed', status: 401 })
        expect(JSON.stringify(probeResult)).toContain('[redacted]')
      } else {
        expect(probeResult).toEqual(savedResult)
      }
      if (shape === 'redirect') {
        // the redirect goes to another origin (localhost vs 127.0.0.1): fetch drops the Authorization header there
        const hop = probeLog.find((r) => r.path.startsWith('/probe/internal'))
        expect(hop).toBeDefined()
        expect(hop?.headers?.authorization).toBeUndefined()
        expect(probeLog[0]?.headers?.authorization).toBe(`Bearer ${KEY}`)
      }
    },
  )

  it.each(['internal', 'unauthorized', 'not-json'])('%s · model list', async (shape) => {
    const d = draft(shape)
    const saved = await api.call('providers.create', {
      body: { label: shape, ...d, apiKey: KEY, auth: { type: 'api_key' } },
    })
    const from = mock.requests.length
    const savedOutcome = await api
      .call('providers.models', { params: { providerId: saved.id } })
      .then(
        (r) => ({ items: r.items }),
        (e: { status: number }) => ({ status: e.status }),
      )
    const savedLog = mock.requests.slice(from)
    const mid = mock.requests.length
    const res = await probe(d, 'models')
    expect(strip(mock.requests.slice(mid))).toEqual(strip(savedLog))
    if ('items' in savedOutcome)
      expect(res).toEqual({ outcome: 'models', items: savedOutcome.items })
    else expect(res).toMatchObject({ outcome: 'failed', status: 401, code: 'HTTP_401' })
  })

  it('image, speech and text drafts get a real list from the mock where the protocol has a cheap read-only endpoint', async () => {
    for (const [protocol, kind] of [
      ['openai-chat', 'llm'],
      ['gemini-chat', 'llm'],
      ['openai-images', 'image'],
      ['gemini-image', 'image'],
      ['openai-tts', 'tts'],
    ] as const) {
      const res = await probe(draft('internal', protocol, kind), 'test')
      expect(res.outcome, protocol).toBe('ok')
    }
    // video has no such endpoint: nothing is sent
    const before = mock.requests.length
    expect((await probe(draft('internal', 'ark-video', 'video'), 'test')).outcome).toBe(
      'unverifiable',
    )
    expect((await probe(draft('internal', 'ark-video', 'video'), 'models')).outcome).toBe(
      'no_model_list',
    )
    expect(mock.requests.length).toBe(before)
  })
})

describe('bottom lines against the real mock', () => {
  it('an address the rules refuse never reaches the mock: 0 requests, same code as providers.create', async () => {
    const before = mock.requests.length
    for (const baseUrl of [
      `${mock.url}/v1?x=1`,
      `${mock.url}/v1#x`,
      `${mock.url}/{ws}/v1`,
      `${mock.url}/%7Bws%7D/v1`,
    ]) {
      const d = { ...draft('internal'), baseUrl }
      const created = await api.call('providers.create', { body: { label: 'x', ...d } }).then(
        () => undefined,
        (e: { status: number; code: string }) => e,
      )
      for (const action of ['models', 'test'] as const) {
        const probed = await probe(d, action).then(
          () => undefined,
          (e: { status: number; code: string }) => e,
        )
        expect(probed, baseUrl).toBeDefined()
        expect(probed?.code, baseUrl).toBe(created?.code)
        expect(probed?.status, baseUrl).toBe(400)
      }
    }
    expect(mock.requests.length).toBe(before)
  })

  it('probing alone leaves the key nowhere: no file in a fresh data directory, no log line', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dramai-mock-probe-clean-'))
    const lines: unknown[][] = []
    const fresh = await createServer({
      dataDir: dir,
      port: 0,
      validateResponses: true,
      logger: {
        error: (...a: unknown[]) => lines.push(a),
        info: (...a: unknown[]) => lines.push(a),
      },
    })
    try {
      const client = createClient({ baseUrl: fresh.url })
      for (const shape of ['internal', 'unauthorized', 'redirect', 'not-json', 'echo-key']) {
        for (const action of ['models', 'test'] as const) {
          await client.call('providers.probe', {
            body: { action, ...draft(shape), auth: { type: 'api_key', apiKey: KEY } },
          })
        }
      }
      expect((await client.call('providers.list')).items).toEqual([])
      const walk = async (rel = ''): Promise<string[]> => {
        const out: string[] = []
        for (const e of await readdir(join(dir, rel), { withFileTypes: true })) {
          const p = join(rel, e.name)
          if (e.isDirectory()) out.push(...(await walk(p)))
          else out.push(p)
        }
        return out
      }
      for (const f of await walk())
        expect((await readFile(join(dir, f))).includes(KEY), f).toBe(false)
      expect(JSON.stringify(lines)).not.toContain(KEY)
    } finally {
      await fresh.close({ graceful: false })
      await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
    }
  })
})
