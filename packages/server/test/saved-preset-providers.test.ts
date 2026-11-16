import { readFileSync, writeFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@dramai/api'
import type { ProviderConfig } from '@dramai/core'
import { cleanupAll, startServer } from './helpers.ts'
import type { Harness } from './helpers.ts'
import { addProviders, prepareEpisodeViaApi, waitJobsIdle } from './api-flow.ts'
import { fakeLlm, fakeProviders, locateMedia, mediaFactory } from './fakes.ts'
import type { MediaEnv } from './fakes.ts'

/**
 * Providers that were saved from four built-in presets which are no longer in the catalogue.
 *
 * `fixtures/saved-providers/*.json` hold what the server stored and returned for each of them when the presets still
 * existed (made with `providers.fromPreset`, a fake key). They must still be read, shown as ordinary providers and
 * generate with the same protocol and the same requests as before.
 * `generation-requests.golden.json` was produced by the code from before the presets were removed (set UPDATE_GOLDEN=1
 * to regenerate it on such a checkout).
 */
const IDS = [
  '302ai-chat',
  '302-image-seedream',
  '302-image-nano-banana',
  '302-i2v-wan-flash',
] as const
type FixtureId = (typeof IDS)[number]
interface Fixture {
  stored: ProviderConfig
  dto: Record<string, unknown> & { id: string; presetId: string }
}
const dir = new URL('./fixtures/saved-providers/', import.meta.url)
const fixture = (id: FixtureId): Fixture =>
  JSON.parse(readFileSync(new URL(`${id}.json`, dir), 'utf8')) as Fixture
const FIXTURES = Object.fromEntries(IDS.map((id) => [id, fixture(id)])) as Record<
  FixtureId,
  Fixture
>
const KEY = 'sk-fixture-not-a-real-key'
const goldenUrl = new URL('generation-requests.golden.json', dir)

afterEach(cleanupAll)

/** Put the saved configs into a fresh data directory exactly as they were stored (no preset involved). */
async function seed(h: Harness) {
  for (const id of IDS) {
    const { stored } = FIXTURES[id]
    await h.server.ctx.store.providers.put(stored)
    await h.server.ctx.secrets.set(stored.secretRef!, KEY)
  }
}

/** The things that identify a request, with long strings (prompts, base64 images) replaced by a marker. */
function shape(v: unknown): unknown {
  if (typeof v === 'string') return v.length > 60 ? '<long string>' : v
  if (Array.isArray(v)) return v.map(shape)
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]))
  return v
}

describe('providers saved from presets that are no longer in the catalogue: read', () => {
  it('providers.list and providers.get return exactly what the original save returned', async () => {
    const h = await startServer({ startWorker: false })
    await seed(h)
    const list = (await h.client.call('providers.list')).items
    for (const id of IDS) {
      const { dto } = FIXTURES[id]
      expect(
        list.find((p) => p.id === dto.id),
        id,
      ).toEqual(dto)
      expect(await h.client.call('providers.get', { params: { providerId: dto.id } }), id).toEqual(
        dto,
      )
    }
  })

  it('the catalogue does not list them, yet nothing about the saved providers refers to a missing preset', async () => {
    const h = await startServer({ startWorker: false })
    await seed(h)
    const presets = (await h.client.call('presets.list')).items
    for (const id of IDS)
      expect(
        presets.some((p) => p.id === id),
        id,
      ).toBe(false)
    // the stored `presetId` stays as it was; reading, listing and the capability view all work regardless
    for (const id of IDS) {
      const { dto } = FIXTURES[id]
      expect(dto.presetId).toBe(id)
      const cap = await h.client.call('providers.capability', { params: { providerId: dto.id } })
      expect(cap.capability, id).toBeDefined()
    }
  })

  it('in every language the saved text is shown as saved, like any text the user wrote (no preset to translate it from)', async () => {
    const h = await startServer({ startWorker: false })
    await seed(h)
    for (const locale of ['zh-CN', 'zh-TW', 'en']) {
      const c = createClient({ baseUrl: h.server.url, token: h.server.token, locale })
      const list = (await c.call('providers.list')).items
      for (const id of IDS) {
        const { dto } = FIXTURES[id]
        const got = list.find((p) => p.id === dto.id)!
        expect(got.label, `${id}/${locale}`).toBe(dto.label)
        expect(got.notes, `${id}/${locale}`).toBe(dto.notes)
        expect(got.knownLimitations, `${id}/${locale}`).toEqual(dto.knownLimitations)
      }
    }
  })

  it('they edit, disable and delete like any provider', async () => {
    const h = await startServer({ startWorker: false })
    await seed(h)
    const { dto } = FIXTURES['302-image-seedream']
    const edited = await h.client.call('providers.update', {
      params: { providerId: dto.id },
      body: { label: 'My Seedream', model: 'doubao-seedream-5-0-260128', enabled: false },
    })
    expect(edited).toMatchObject({
      label: 'My Seedream',
      enabled: false,
      protocol: 'openai-images',
    })
    expect(edited.baseUrl).toBe(dto.baseUrl)
    await h.client.call('providers.delete', { params: { providerId: dto.id } })
    const left = (await h.client.call('providers.list')).items.map((p) => p.id)
    expect(left).not.toContain(dto.id)
    expect(left).toHaveLength(IDS.length - 1)
  })
})

describe('providers saved from presets that are no longer in the catalogue: text', () => {
  it('the chat provider is called with the same address, key and body as before', async () => {
    const seen: Array<{ url: string; auth?: string; body?: Record<string, unknown> }> = []
    const h = await startServer({
      startWorker: false,
      executor: {
        fetch: (async (url: string, init?: RequestInit) => {
          seen.push({
            url,
            auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
            body: init?.body
              ? (JSON.parse(String(init.body)) as Record<string, unknown>)
              : undefined,
          })
          if (url.endsWith('/models'))
            return new Response(JSON.stringify({ data: [{ id: 'gpt-4o-mini' }] }), { status: 200 })
          const ev = (d: unknown) => `data: ${JSON.stringify(d)}\n\n`
          return new Response(
            ev({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }) +
              'data: [DONE]\n\n',
            { status: 200 },
          )
        }) as never,
      },
    })
    await seed(h)
    const chat = FIXTURES['302ai-chat']
    await h.server.ctx.settings.patchActive('llm', chat.dto.id)
    const out = await h.server.ctx.deps.llm.complete({
      task: 't',
      messages: [{ role: 'user', content: 'u' }],
    })
    expect(out.text).toBe('ok')
    const call = seen.find((s) => s.url.endsWith('/chat/completions'))!
    expect(call.url).toBe(`${chat.stored.baseUrl}/chat/completions`)
    expect(call.auth).toBe(`Bearer ${KEY}`)
    expect(call.body).toMatchObject({ model: 'gpt-4o-mini', stream: true })
    // the connection test goes to the model list of the same address
    expect(
      await h.client.call('providers.test', { params: { providerId: chat.dto.id } }),
    ).toMatchObject({ outcome: 'ok' })
    expect(seen.at(-1)!.url).toBe(`${chat.stored.baseUrl}/models`)
  })
})

describe('providers saved from presets that are no longer in the catalogue: a whole simulated generation', () => {
  let media: MediaEnv | undefined
  beforeAll(async () => {
    media = await locateMedia()
    if (!media) console.warn('[saved-preset-providers] generation SKIPPED: ffmpeg not found')
  })
  afterAll(cleanupAll)

  it('sheets (openai-images), a shot image (gemini-image) and a shot video (aliyun-video) send the golden requests', async (ctx) => {
    if (!media) return ctx.skip()
    const fake = fakeProviders(mediaFactory(media.bins))
    const sent: Array<{ method: string; url: string; headers: unknown; body: unknown }> = []
    const png = Buffer.from(await mediaFactory(media.bins).png(99)).toString('base64')
    const fetch = (async (url: string, init?: RequestInit) => {
      const host = new URL(url).hostname
      if (host.startsWith('api.302')) {
        let body: unknown = init?.body
        if (typeof body === 'string') {
          try {
            body = JSON.parse(body)
          } catch {
            /* keep the text */
          }
        }
        sent.push({ method: init?.method ?? 'GET', url, headers: init?.headers, body: shape(body) })
      }
      if (url.endsWith('/images/generations'))
        return new Response(JSON.stringify({ data: [{ b64_json: png }] }), { status: 200 })
      return fake.fetch(url, init)
    }) as never
    const h = await startServer({
      llm: fakeLlm().client,
      executor: { fetch, sleep: async () => {} },
      workerIntervalMs: 20,
    })
    const ids = await addProviders(h)
    await seed(h)
    const nano = FIXTURES['302-image-nano-banana'].dto.id
    const seedream = FIXTURES['302-image-seedream'].dto.id
    const wan = FIXTURES['302-i2v-wan-flash'].dto.id
    const prepared = await prepareEpisodeViaApi(h, ids)
    const { items: assets } = await h.client.call('assets.list', {
      params: { projectId: prepared.projectId },
    })
    const detail = await h.client.call('episodes.get', {
      params: { episodeId: prepared.episode.id },
    })
    const shot = detail.shots[0]!

    const run = async (item: Record<string, unknown>) => {
      const r = await h.client.call('generate.submit', {
        params: { projectId: prepared.projectId },
        body: { items: [item as never], confirmUnverified: true },
      })
      expect(r.failed).toEqual([])
      expect(r.blocked).toEqual([])
      const jobs = await waitJobsIdle(h, prepared.projectId)
      expect(jobs.every((j) => j.status === 'succeeded')).toBe(true)
    }
    for (const a of assets)
      await run({ target: { kind: 'asset_sheet', assetId: a.id }, providerId: seedream })
    await run({ target: { kind: 'shot_image', shotId: shot.id }, providerId: nano })
    await run({
      target: { kind: 'shot_video', shotId: shot.id },
      providerId: wan,
      resolution: '720P',
    })

    const capabilities: Record<string, unknown> = {}
    for (const id of ['302-image-seedream', '302-image-nano-banana', '302-i2v-wan-flash'] as const)
      capabilities[id] = await h.client.call('providers.capability', {
        params: { providerId: FIXTURES[id].dto.id },
      })
    // the first request of each kind (sheet / shot image / video submit / poll / download), as sent
    const firsts = sent.filter(
      (r, i) => sent.findIndex((x) => x.method === r.method && x.url === r.url) === i,
    )
    const result = { requests: firsts, capabilities }
    if (process.env.UPDATE_GOLDEN) writeFileSync(goldenUrl, JSON.stringify(result, null, 2) + '\n')
    const golden = JSON.parse(readFileSync(goldenUrl, 'utf8')) as typeof result
    // Only the free-text provenance, price notes and quirks were reworded (quirks are compared by count) when the vendor name was taken out of them;
    // every request and every capability fact is compared as it was.
    const facts = (v: unknown) =>
      JSON.parse(JSON.stringify(v), (k, x) =>
        k === 'provenance' || k === 'note'
          ? undefined
          : k === 'quirks'
            ? (x as unknown[]).length
            : x,
      )
    expect(facts(result)).toEqual(facts(golden))
    // and the key really was the saved one
    for (const r of firsts.filter((x) => x.method === 'POST'))
      expect(JSON.stringify(r.headers)).toContain(KEY)
  }, 240_000)
})
