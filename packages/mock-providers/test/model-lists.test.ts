import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@dramai/api'
import type { ProviderKind } from '@dramai/core'
import { createServer } from '@dramai/server'
import type { DramaiServer } from '@dramai/server'
import { startMockProviders } from '../src/index.ts'
import type { MockProviders } from '../src/index.ts'

/**
 * "Get the model list" in the demo: every path of the mock answers in one shape only (OpenAI `data[]` on `/models` and
 * `/v1/models`, Gemini `models[]` on `/v1beta/models`), the way real services do. A response that carried both made the
 * parser read the Gemini / account-login shape and return an empty list.
 */
let mock: MockProviders
let server: DramaiServer
let api: ReturnType<typeof createClient>
let dataDir: string

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'dramai-mock-lists-'))
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

const IDS = [
  'deepseek-chat',
  'gemini-2.5-flash-image',
  'doubao-seedream-5-0-260128',
  'tts-1',
  'mock-llm',
]

describe('the mock’s model lists', () => {
  it('each path answers in exactly one shape', async () => {
    for (const path of ['/models', '/v1/models']) {
      const body = (await (await fetch(mock.url + path)).json()) as Record<string, unknown>
      expect(Object.keys(body).sort(), path).toEqual(['data', 'object'])
      expect(
        (body.data as Array<{ id: string }>).map((m) => m.id),
        path,
      ).toEqual(IDS)
    }
    const gemini = (await (await fetch(mock.url + '/v1beta/models')).json()) as Record<
      string,
      unknown
    >
    expect(Object.keys(gemini)).toEqual(['models'])
    expect((gemini.models as Array<{ name: string }>).map((m) => m.name)).toEqual(
      IDS.map((id) => `models/${id}`),
    )
  })

  const LISTABLE: Array<[string, ProviderKind]> = [
    ['openai-chat', 'llm'],
    ['openai-responses', 'llm'],
    ['anthropic-messages', 'llm'],
    ['gemini-chat', 'llm'],
    ['openai-images', 'image'],
    ['gemini-image', 'image'],
    ['openai-tts', 'tts'],
  ]
  it.each(LISTABLE)(
    '%s: both “get the model list” routes return the five models; the connection test counts five',
    async (protocol, kind) => {
      const body = {
        kind,
        protocol: protocol as never,
        baseUrl: mock.url,
        model: 'gemini-2.5-flash-image',
      }
      const saved = await api.call('providers.create', {
        body: {
          label: protocol,
          ...body,
          apiKey: 'mock-key-not-a-secret',
          auth: { type: 'api_key' },
        },
      })
      const fromSaved = (await api.call('providers.models', { params: { providerId: saved.id } }))
        .items
      const fromDraft = await api.call('providers.probe', {
        body: {
          action: 'models',
          ...body,
          auth: { type: 'api_key', apiKey: 'mock-key-not-a-secret' },
        },
      })
      expect(fromSaved.map((m) => m.id)).toEqual(IDS)
      expect(fromDraft).toEqual({ outcome: 'models', items: fromSaved })
      expect(await api.call('providers.test', { params: { providerId: saved.id } })).toMatchObject({
        outcome: 'ok',
        modelCount: 5,
        modelListed: true,
      })
    },
  )
})
