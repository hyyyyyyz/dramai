import { afterEach, describe, expect, it } from 'vitest'
import { createClient } from '@dramai/api'
import { createServer } from '@dramai/server'
import type { DramaiServer } from '@dramai/server'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEMO_CURRENCY,
  demoModelProfiles,
  demoProviders,
  writeDemoCatalog,
} from '../src/demo-lib.ts'
import { startMockProviders } from '../src/index.ts'
import type { MockProviders } from '../src/index.ts'
import { addProviders, waitJobs } from './flow.ts'
import { STORY } from './story.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

async function boot(withDemoCatalog: boolean) {
  const dataDir = await mkdtemp(join(tmpdir(), 'dramai-prices-'))
  if (withDemoCatalog) await writeDemoCatalog(dataDir)
  const mock: MockProviders = await startMockProviders({ config: { streamChunkMs: 0 } })
  const server: DramaiServer = await createServer({
    dataDir,
    port: 0,
    workerIntervalMs: 20,
    logger: { error: () => {} },
    validateResponses: true,
  })
  cleanups.push(async () => {
    await server.close({ graceful: false })
    await mock.close()
    await rm(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
  })
  const api = createClient({ baseUrl: server.url })
  const ids = await addProviders(api, mock.url)
  const project = await api.call('projects.create', { body: { name: '旧信', aspectRatio: '9:16' } })
  const form = new FormData()
  form.set('file', new File([STORY], '旧信.txt', { type: 'text/plain' }))
  await api.call('materials.upload', { params: { projectId: project.id }, form })
  await api.call('episodes.plan', {
    params: { projectId: project.id },
    body: { targetChars: 6000 },
  })
  await waitJobs(api, project.id)
  const episodeId = (await api.call('episodes.list', { params: { projectId: project.id } }))
    .items[0]!.id
  await api.call('episodes.breakdown', { params: { episodeId }, body: {} })
  await waitJobs(api, project.id)
  return { api, ids, projectId: project.id, episodeId }
}

describe('demo prices: every demo model has a price, clearly marked as fictional', () => {
  it('the generated model data labels itself as demo in the currency, note, provenance and name', () => {
    const profiles = demoModelProfiles() as Array<{
      displayName: string
      provenance: string
      pricing: Array<{ currency: string; note: string }>
      quirks: string[]
    }>
    expect(profiles).toHaveLength(demoProviders('en').length)
    for (const p of profiles) {
      expect(p.pricing.length).toBeGreaterThan(0)
      expect(
        p.pricing.every(
          (x) =>
            x.currency === DEMO_CURRENCY && /演示价格/.test(x.note) && /Demo price/.test(x.note),
        ),
      ).toBe(true)
      expect(p.provenance).toMatch(/^DEMO PRICES/)
      expect(p.displayName).toMatch(/demo prices/)
      expect(p.quirks.join(' ')).toContain('DEMO PRICES')
    }
  })

  it("capability views show the demo prices; the capability itself is the real model's", async () => {
    const { api, ids } = await boot(true)
    for (const id of ['llm', 'img', 'seedream', 'vid', 'seedance', 'tts']) {
      const view = await api.call('providers.capability', { params: { providerId: ids[id]! } })
      expect(view.pricing.length, id).toBeGreaterThan(0)
      expect(
        view.pricing.every((p) => p.currency === DEMO_CURRENCY && /Demo price/.test(p.note ?? '')),
        id,
      ).toBe(true)
      expect(view.provenance, id).toMatch(/^DEMO PRICES/)
    }
    // 能力还是真实画像的（Seedance 的原生人声、首帧）
    expect(
      (await api.call('providers.capability', { params: { providerId: ids.seedance! } })).capability
        .firstFrame,
    ).toBeDefined()
  })

  it('without the demo data file the video model has no price — the file is the only thing that changes it', async () => {
    const { api, ids } = await boot(false)
    expect(
      (await api.call('providers.capability', { params: { providerId: ids.seedance! } })).pricing,
    ).toEqual([])
  })

  it('a whole episode can be priced end to end (video included) so the money-confirmation flow can be rehearsed', async () => {
    const { api, ids, episodeId } = await boot(true)
    for (const [video, resolution] of [
      [ids.vid!, '720P'],
      [ids.seedance!, '720p'],
    ] as const) {
      const plan = await api.call('episodes.preflight', {
        params: { episodeId },
        body: {
          assetSheets: ids.img,
          shotImages: ids.img,
          shotVideos: video,
          narration: ids.tts,
          textModel: ids.llm,
          resolution,
          confirmUnverified: true,
        },
      })
      expect(plan.targets.some((t) => t.target.kind === 'shot_video')).toBe(true)
      expect(plan.totals.unpriced, `unpriced with ${video}`).toBe(0)
      expect(Object.keys(plan.totals.byCurrency)).toEqual([DEMO_CURRENCY])
      expect(plan.totals.byCurrency[DEMO_CURRENCY]!.amount).toBeGreaterThan(0)
      expect(plan.textSteps.every((s) => s.estimate.priced)).toBe(true)
    }
    // 用户设了折算，演示价格也能折算（折算是用户自己的设置）
    const settings = await api.call('settings.get')
    await api.call('settings.update', {
      body: {
        ...settings,
        cost: { conversion: { targetCurrency: 'CNY', rates: { [DEMO_CURRENCY]: 2 } } },
      },
    })
    const converted = await api.call('episodes.preflight', {
      params: { episodeId },
      body: { shotVideos: ids.vid, resolution: '720P', confirmUnverified: true },
    })
    expect(converted.totals.converted).toMatchObject({ currency: 'CNY' })
    expect(converted.totals.converted!.amount).toBeCloseTo(
      converted.totals.byCurrency[DEMO_CURRENCY]!.amount * 2,
      4,
    )
  }, 60_000)

  it('video prices follow the resolution tier (higher tier costs more) and fall back when the tier is unknown', async () => {
    const { api, ids, episodeId } = await boot(true)
    const cost = async (resolution: string) =>
      (
        await api.call('episodes.preflight', {
          params: { episodeId },
          body: { shotVideos: ids.vid, resolution, confirmUnverified: true },
        })
      ).totals.byCurrency[DEMO_CURRENCY]!.amount
    const low = await cost('480P')
    const high = await cost('720P')
    expect(high).toBeGreaterThan(low)
    expect(await cost('360P')).toBeGreaterThan(0) // 兜底价
  }, 60_000)
})
