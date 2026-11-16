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
 * An upstream that repeats the credential it was given in its error body (the mock's `echo-key` shape). The credential
 * must not reach any exit: the answer of `providers.test` / `providers.models`, a failed job's record, the events, the
 * server log, or any file in the data directory other than the secret store itself.
 */
const KEY = 'sk-echo-0123456789abcdef'
let mock: MockProviders
let server: DramaiServer
let api: ReturnType<typeof createClient>
let dataDir: string
const logs: unknown[][] = []
const events: unknown[] = []
const ids: Record<string, string> = {}

const TEXT = [
  ['openai-chat', 'v1'],
  ['openai-responses', 'v1'],
  ['anthropic-messages', ''],
  ['gemini-chat', ''],
] as const
const IMAGE = [
  ['gemini-image', ''],
  ['openai-images', 'v1'],
] as const

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'dramai-mock-redact-'))
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
  for (const [protocol, path] of [...TEXT, ...IMAGE]) {
    const created = await api.call('providers.create', {
      body: {
        label: protocol,
        kind: TEXT.some(([p]) => p === protocol) ? 'llm' : 'image',
        protocol,
        baseUrl: `${mock.url}/probe/echo-key${path ? `/${path}` : ''}`,
        model: 'm',
        apiKey: KEY,
        auth: { type: 'api_key' },
      },
    })
    ids[protocol] = created.id
  }
}, 60_000)

afterAll(async () => {
  await server?.close({ graceful: false })
  await mock?.close()
  await rm(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
})

describe('an upstream that repeats the key: nothing that leaves the server carries it', () => {
  it.each([...TEXT, ...IMAGE].map(([p]) => p))('providers.test · %s', async (protocol) => {
    const res = await api.call('providers.test', { params: { providerId: ids[protocol]! } })
    expect(res).toMatchObject({ outcome: 'failed', status: 401 })
    expect(JSON.stringify(res)).not.toContain(KEY)
    expect(JSON.stringify(res)).toContain('[redacted]')
  })

  it.each(TEXT.map(([p]) => p))('providers.models · %s', async (protocol) => {
    const err = await api.call('providers.models', { params: { providerId: ids[protocol]! } }).then(
      () => undefined,
      (e: Error & { status: number; details?: unknown }) => e,
    )
    expect(err?.status).toBe(502)
    expect(`${err?.message} ${JSON.stringify(err?.details)}`).not.toContain(KEY)
  })

  it('a failed text job (LLM request refused with the key echoed) records, announces and logs it without the key', async () => {
    for (const [protocol] of TEXT) {
      const settings = await api.call('settings.get')
      await api.call('settings.update', {
        body: {
          ...settings,
          activeProviders: { ...settings.activeProviders, llm: ids[protocol]! },
        },
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
      await api.call('episodes.breakdown', { params: { episodeId }, body: {} }) // the first request to the model
      const jobs = await waitJobs(api, project.id, { allowFailed: true })
      const failed = jobs.filter((j) => j.status === 'failed')
      expect(failed.length, protocol).toBeGreaterThan(0)
      expect(JSON.stringify(jobs), protocol).not.toContain(KEY)
      expect(JSON.stringify(failed.map((j) => j.error)), protocol).toContain('[redacted]')
    }
  }, 120_000)

  it('a failed image job (generation refused with the key echoed) records, announces and logs it without the key', async () => {
    for (const [protocol] of IMAGE) {
      const project = await api.call('projects.create', {
        body: { name: protocol, aspectRatio: '9:16' },
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
              providerId: ids[protocol]!,
              confirmUnverified: true,
            },
          ],
        },
      })
      expect(res.blocked, protocol).toEqual([])
      const jobs = await waitJobs(api, project.id, { allowFailed: true })
      const failed = jobs.filter((j) => j.status === 'failed')
      expect(failed.length, protocol).toBeGreaterThan(0)
      expect(JSON.stringify(jobs), protocol).not.toContain(KEY)
      expect(JSON.stringify(failed.map((j) => j.error)), protocol).toContain('[redacted]')
    }
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
