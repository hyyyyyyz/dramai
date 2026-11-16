import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@dramai/api'
import { createServer } from '@dramai/server'
import type { DramaiServer } from '@dramai/server'
import { startMockProviders } from '../src/index.ts'
import type { MockProviders } from '../src/index.ts'
import { waitJobs } from './flow.ts'
import { STORY } from './story.ts'

/**
 * More places an upstream can repeat the key it was given, each run against real HTTP:
 *  - `echo-code`: a 401 whose error `code`, `type` and `status` are the key (not only the message);
 *  - `echo-stream`: HTTP 200 text streams whose error event repeats it (Responses, Anthropic, Gemini; OpenAI chat has
 *    no error event: it ignores the frame);
 *  - `echo-business`: HTTP 200 image responses whose per-image error repeats it.
 * It must not reach the answer, a task record, the events, the log or any file of the data directory (the secret
 * store aside).
 */
const KEY = 'sk-echo-0123456789abcdef'
let mock: MockProviders
let server: DramaiServer
let api: ReturnType<typeof createClient>
let dataDir: string
const logs: unknown[][] = []
const events: unknown[] = []

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'dramai-mock-redact2-'))
  mock = await startMockProviders()
  server = await createServer({
    dataDir,
    port: 0,
    validateResponses: true,
    workerIntervalMs: 20,
    executor: { sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 15))) },
    logger: {
      error: (...a: unknown[]) => logs.push(a),
      info: (...a: unknown[]) => logs.push(a),
    },
  })
  server.ctx.bus.subscribe((e) => events.push(e))
  api = createClient({ baseUrl: server.url })
}, 60_000)

afterAll(async () => {
  await server?.close({ graceful: false })
  await mock?.close()
  await rm(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
})

const LISTABLE = [
  ['openai-chat', 'llm', '/v1'],
  ['openai-responses', 'llm', '/v1'],
  ['anthropic-messages', 'llm', ''],
  ['gemini-chat', 'llm', ''],
  ['openai-images', 'image', '/v1'],
  ['gemini-image', 'image', ''],
  ['openai-tts', 'tts', '/v1'],
] as const
const base = (shape: string, path: string) => `${mock.url}/probe/${shape}${path}`
const create = (protocol: string, kind: string, baseUrl: string) =>
  api.call('providers.create', {
    body: {
      label: protocol,
      kind: kind as never,
      protocol: protocol as never,
      baseUrl,
      model: 'm',
      apiKey: KEY,
      auth: { type: 'api_key' },
    },
  })

describe('the key in the error code, type and status', () => {
  it.each(LISTABLE)(
    '%s: providers.test, providers.models, probe · test, probe · models',
    async (protocol, kind, path) => {
      const baseUrl = base('echo-code', path)
      const saved = await create(protocol, kind, baseUrl)
      const answers = [
        await api.call('providers.test', { params: { providerId: saved.id } }),
        await api.call('providers.models', { params: { providerId: saved.id } }).then(
          (r) => r,
          (e: Error & { details?: unknown }) => ({ message: e.message, details: e.details }),
        ),
        ...(await Promise.all(
          (['test', 'models'] as const).map((action) =>
            api.call('providers.probe', {
              body: {
                action,
                kind,
                protocol: protocol as never,
                baseUrl,
                auth: { type: 'api_key', apiKey: KEY },
              },
            }),
          ),
        )),
      ]
      expect(JSON.stringify(answers)).not.toContain(KEY)
      // the failure itself is intact: a failed result with its status and a code. Where the protocol reads the code from the
      // upstream's body (Responses `code`, Anthropic `type`, Gemini `status`) it is the upstream's string, redacted; for
      // the others it is the server's own `HTTP_401`, untouched.
      const upstreamCoded = ['openai-responses', 'anthropic-messages', 'gemini-chat'].includes(
        protocol,
      )
      for (const i of [0, 2, 3])
        expect(answers[i], `${protocol}/${i}`).toMatchObject({
          outcome: 'failed',
          status: 401,
          code: upstreamCoded ? '[redacted]' : 'HTTP_401',
        })
    },
  )
})

describe('a failed task whose upstream repeated the key in HTTP 200 answers', () => {
  const failedJobs = async (projectId: string) =>
    (await waitJobs(api, projectId, { allowFailed: true })).filter((j) => j.status === 'failed')

  it.each([
    ['openai-chat', ''],
    ['openai-responses', '/v1'],
    ['anthropic-messages', ''],
    ['gemini-chat', ''],
  ])(
    'text stream · %s',
    async (protocol, path) => {
      const p = await create(protocol, 'llm', base('echo-stream', path))
      const settings = await api.call('settings.get')
      await api.call('settings.update', {
        body: { ...settings, activeProviders: { ...settings.activeProviders, llm: p.id } },
      })
      const project = await api.call('projects.create', {
        body: { name: protocol, aspectRatio: '9:16' },
      })
      const form = new FormData()
      form.set('file', new File([STORY], '旧信.txt', { type: 'text/plain' }))
      await api.call('materials.upload', { params: { projectId: project.id }, form })
      await api.call('episodes.plan', {
        params: { projectId: project.id },
        body: { targetChars: 6000 },
      })
      await waitJobs(api, project.id, { allowFailed: true })
      const episodeId = (await api.call('episodes.list', { params: { projectId: project.id } }))
        .items[0]!.id
      await api.call('episodes.breakdown', { params: { episodeId }, body: {} })
      const failed = await failedJobs(project.id)
      expect(failed.length, protocol).toBeGreaterThan(0)
      const all = JSON.stringify(await api.call('jobs.list', { query: { projectId: project.id } }))
      expect(all, protocol).not.toContain(KEY)
      // Responses / Anthropic / Gemini turn the stream's error event into the task's error, key removed; OpenAI chat
      // has no error event (the frame is ignored), so the key never enters anything
      if (protocol !== 'openai-chat')
        expect(JSON.stringify(failed.map((j) => j.error)), protocol).toContain('[redacted]')
    },
    120_000,
  )

  it('image response with a per-image error · openai-images', async () => {
    const p = await create('openai-images', 'image', base('echo-business', '/v1'))
    const project = await api.call('projects.create', {
      body: { name: 'img', aspectRatio: '9:16' },
    })
    const asset = await api.call('assets.create', {
      params: { projectId: project.id },
      body: { kind: 'character', name: '林夕', appearance: '短发，风衣' },
    })
    const res = await api.call('generate.submit', {
      params: { projectId: project.id },
      body: {
        items: [
          {
            target: { kind: 'asset_sheet', assetId: asset.id },
            providerId: p.id,
            confirmUnverified: true,
          },
        ],
      },
    })
    expect(res.blocked).toEqual([])
    const failed = await failedJobs(project.id)
    expect(failed.length).toBeGreaterThan(0)
    expect(
      JSON.stringify(await api.call('jobs.list', { query: { projectId: project.id } })),
    ).not.toContain(KEY)
    expect(JSON.stringify(failed.map((j) => j.error))).toContain('[redacted]')
  }, 120_000)

  it('the events, the log and every file in the data directory (the secret store aside) are free of it', async () => {
    expect(JSON.stringify(events)).not.toContain(KEY)
    expect(JSON.stringify(logs)).not.toContain(KEY)
    const walk = async (rel = ''): Promise<string[]> => {
      const out: string[] = []
      for (const e of await readdir(join(dataDir, rel), { withFileTypes: true })) {
        const p = join(rel, e.name)
        if (e.isDirectory()) out.push(...(await walk(p)))
        else out.push(p)
      }
      return out
    }
    const holders: string[] = []
    for (const f of await walk())
      if ((await readFile(join(dataDir, f))).includes(KEY)) holders.push(f)
    expect(holders).toEqual(['secrets.json'])
  })
})
