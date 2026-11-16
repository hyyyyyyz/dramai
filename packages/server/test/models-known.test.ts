import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LOGIN_CHANNEL_ENDPOINTS } from '@dramai/core'
import type { ProviderKind } from '@dramai/core'
import { cleanupAll, startServer } from './helpers.ts'

afterEach(cleanupAll)

const KINDS: ProviderKind[] = ['llm', 'image', 'video', 'tts']
const bundled = JSON.parse(
  readFileSync(new URL('../../core/data/models/models.json', import.meta.url), 'utf8'),
) as {
  models: Array<{
    protocol: string
    apiModel: string
    candidate?: boolean
    capability: { media: 'image' | 'video' | 'audio' }
    pricing: Array<{ currency: string }>
  }>
}
const kindOf = (media: 'image' | 'video' | 'audio'): ProviderKind =>
  media === 'audio' ? 'tts' : media

describe('models.known', () => {
  it('returns what the model data says for each kind: a view of the data, not a list in the code', async () => {
    const h = await startServer({ startWorker: false })
    for (const kind of KINDS) {
      const { items } = await h.client.call('models.known', { query: { kind } })
      const expected = new Map<string, Set<string>>()
      for (const m of bundled.models) {
        if (m.candidate === false || kindOf(m.capability.media) !== kind) continue
        expected.set(m.apiModel, (expected.get(m.apiModel) ?? new Set()).add(m.protocol))
      }
      expect(
        items.map((i) => i.id),
        kind,
      ).toEqual([...expected.keys()].sort())
      for (const i of items) {
        expect(i.kind).toBe(kind)
        expect(i.protocols, i.id).toEqual([...expected.get(i.id)!].sort())
      }
    }
    // text models have no profiles: they come from the provider's own list (providers.probe · models)
    expect((await h.client.call('models.known', { query: { kind: 'llm' } })).items).toEqual([])
  })

  it('is in alphabetical order, favours nobody, and carries no status, price or recommendation', async () => {
    const h = await startServer({ startWorker: false })
    for (const kind of KINDS) {
      const { items } = await h.client.call('models.known', { query: { kind } })
      const ids = items.map((i) => i.id)
      expect(ids, kind).toEqual([...ids].sort())
      for (const i of items) {
        expect(
          Object.keys(i)
            .sort()
            .filter((k) => !['id', 'kind', 'protocols', 'displayName'].includes(k)),
        ).toEqual([])
      }
    }
  })

  it('leaves out the combinations that only exist on a relay, lists the real models, and names no removed platform', async () => {
    const h = await startServer({ startWorker: false })
    const hidden = bundled.models.filter((m) => m.candidate === false)
    // the data says which: the four aliyun-video models (a path prefix only a relay has) and the openai-images Seedream
    expect(hidden.map((m) => `${m.protocol}:${m.apiModel}`).sort()).toEqual([
      'aliyun-video:wan2.2-i2v-flash',
      'aliyun-video:wan2.2-i2v-plus',
      'aliyun-video:wan2.5-i2v-preview',
      'aliyun-video:wan2.7-i2v',
      'openai-images:doubao-seedream-5-0-260128',
    ])
    const all = (
      await Promise.all(KINDS.map((kind) => h.client.call('models.known', { query: { kind } })))
    ).flatMap((r) => r.items)
    // gemini-2.5-flash-image is a real model on Google's own address: it is listed (with its gemini-image protocol)
    expect(all.find((i) => i.id === 'gemini-2.5-flash-image')).toMatchObject({
      kind: 'image',
      protocols: ['gemini-image'],
    })
    expect(all.some((i) => i.protocols.includes('aliyun-video'))).toBe(false)
    expect(all.find((i) => i.id === 'doubao-seedream-5-0-260128')?.protocols).toEqual([
      'volcengine-images',
    ])
    expect(JSON.stringify(all)).not.toMatch(/302|PTC/i)
    // the hidden ones are still there for the saved providers that use them (capability and prompt dialect)
    const found = h.server.ctx.catalog.models.lookup({
      protocol: 'aliyun-video',
      model: 'wan2.2-i2v-flash',
    })
    expect(found.declared).toBe(true)
    expect(found.profile?.pricing).toEqual([]) // no price table: estimates say "unpriced"
  })

  it('filters by protocol; a protocol of another kind gives nothing', async () => {
    const h = await startServer({ startWorker: false })
    const tts = await h.client.call('models.known', {
      query: { kind: 'tts', protocol: 'openai-tts' },
    })
    expect(tts.items.length).toBeGreaterThan(0)
    expect(
      tts.items.every((i) => i.protocols.length === 1 && i.protocols[0] === 'openai-tts'),
    ).toBe(true)
    expect(
      (await h.client.call('models.known', { query: { kind: 'image', protocol: 'openai-tts' } }))
        .items,
    ).toEqual([])
    const imgAll = await h.client.call('models.known', { query: { kind: 'image' } })
    const imgOne = await h.client.call('models.known', {
      query: { kind: 'image', protocol: 'volcengine-images' },
    })
    expect(imgOne.items.length).toBeGreaterThan(0)
    expect(imgOne.items.length).toBeLessThan(imgAll.items.length)
  })

  it('follows the data: a model added to (or hidden in) the user catalogue folder shows up (or not) in the answer', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dramai-known-'))
    try {
      const profile = bundled.models.find(
        (m) => m.protocol === 'openai-tts' && m.apiModel === 'gpt-4o-mini-tts',
      ) as never as Record<string, unknown>
      expect(profile).toBeDefined()
      await mkdir(join(dir, 'catalog', 'models'), { recursive: true })
      await writeFile(
        join(dir, 'catalog', 'models', 'extra.json'),
        JSON.stringify({
          schemaVersion: 1,
          models: [
            { ...profile, id: 'zz-voice', apiModel: 'zz-voice', displayName: 'ZZ voice' },
            { ...profile, candidate: false }, // hides gpt-4o-mini-tts (same protocol + model: the later file wins)
          ],
        }),
      )
      const h = await startServer({ startWorker: false, dataDir: dir })
      const { items } = await h.client.call('models.known', {
        query: { kind: 'tts', protocol: 'openai-tts' },
      })
      expect(items.map((i) => i.id)).toContain('zz-voice')
      expect(items.find((i) => i.id === 'zz-voice')).toMatchObject({
        displayName: 'ZZ voice',
        kind: 'tts',
      })
      expect(items.map((i) => i.id)).not.toContain('gpt-4o-mini-tts')
      const ids = items.map((i) => i.id)
      expect(ids).toEqual([...ids].sort())
      await h.stop()
    } finally {
      await cleanupAll()
      await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
    }
  })

  it('rejects a kind or protocol it does not know', async () => {
    const h = await startServer({ startWorker: false })
    expect((await h.raw('/api/models/known?kind=nope')).status).toBe(400)
    expect((await h.raw('/api/models/known')).status).toBe(400)
    expect((await h.raw('/api/models/known?kind=image&protocol=nope')).status).toBe(400)
  })
})

describe('providers.loginChannels', () => {
  it('is LOGIN_CHANNEL_ENDPOINTS, entry for entry', async () => {
    const h = await startServer({ startWorker: false })
    const { items } = await h.client.call('providers.loginChannels')
    expect(items.map((i) => i.channel).sort()).toEqual(Object.keys(LOGIN_CHANNEL_ENDPOINTS).sort())
    for (const item of items) {
      const fixed = LOGIN_CHANNEL_ENDPOINTS[item.channel]
      expect(item).toMatchObject({ kind: 'llm', protocol: fixed.protocol, baseUrl: fixed.baseUrl })
      // creating a provider with exactly these values is accepted (they are the pinned pair)
      const made = await h.client.call('providers.create', {
        body: {
          label: item.channel,
          kind: item.kind,
          protocol: item.protocol,
          baseUrl: item.baseUrl,
          model: item.suggestedModel ?? 'm',
          auth: { type: 'account_login', channel: item.channel },
        },
      })
      expect(made.auth).toEqual({ type: 'account_login', channel: item.channel })
    }
  })

  it('suggests a model without choosing a company for the user: ChatGPT keeps its own, OpenRouter gets its auto router', async () => {
    const h = await startServer({ startWorker: false })
    const { items } = await h.client.call('providers.loginChannels')
    expect(Object.fromEntries(items.map((i) => [i.channel, i.suggestedModel]))).toEqual({
      'openai-chatgpt': 'gpt-6.1-sol',
      openrouter: 'openrouter/auto',
    })
    for (const i of items) {
      expect(
        Object.keys(i)
          .sort()
          .filter((k) => !['channel', 'kind', 'protocol', 'baseUrl', 'suggestedModel'].includes(k)),
      ).toEqual([])
    }
    // creating a sign-in provider with the suggested model is accepted, and a saved one is unaffected by the suggestion
    const or = items.find((i) => i.channel === 'openrouter')!
    const made = await h.client.call('providers.create', {
      body: {
        label: 'or',
        kind: 'llm',
        protocol: or.protocol,
        baseUrl: or.baseUrl,
        model: or.suggestedModel!,
        auth: { type: 'account_login', channel: 'openrouter' },
      },
    })
    expect(made.model).toBe('openrouter/auto')
  })
})
