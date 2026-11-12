import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanupAll, startServer } from './helpers.ts'
import type { Harness } from './helpers.ts'
import { addProviders, prepareEpisodeViaApi, waitJobsIdle } from './api-flow.ts'
import { fakeLlm, fakeProviders, locateMedia, mediaFactory } from './fakes.ts'
import type { MediaEnv } from './fakes.ts'

/**
 * 用一句话修改设定图（A3 第 5 层）：以当前图为唯一参考、增量指令为唯一提示词；新图成为当前版本、旧图进版本历史；
 * 失败时不改动任何东西；没有可用的图生图通道、没有当前图时在入队前就拒绝；和普通生成走同样的准入 / 预检。
 */
let media: MediaEnv | undefined
beforeAll(async () => {
  media = await locateMedia()
  if (!media) console.warn('[sheet-edit] SKIPPED: ffmpeg not found')
})
afterEach(cleanupAll)

const tick = () => new Promise<void>((r) => setTimeout(r, 5))

async function setup() {
  const providers = fakeProviders(mediaFactory(media!.bins))
  const h = await startServer({
    llm: fakeLlm().client,
    executor: { fetch: providers.fetch, sleep: tick },
    workerIntervalMs: 20,
  })
  const ids = await addProviders(h)
  const { projectId } = await prepareEpisodeViaApi(h, ids, { chapters: 2, fill: 1 })
  const { items: assets } = await h.client.call('assets.list', { params: { projectId } })
  const hero = assets.find((a) => a.kind === 'character')!
  return { providers, h, ids, projectId, hero, assets }
}

const submit = (
  h: Harness,
  projectId: string,
  target: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) =>
  h.client.call('generate.submit', {
    params: { projectId },
    body: { items: [{ target: target as never, ...extra }] },
  })
const preflight = (h: Harness, projectId: string, target: Record<string, unknown>) =>
  h.client.call('generate.preflight', {
    params: { projectId },
    body: { items: [{ target: target as never }] },
  })
const sheetOf = async (h: Harness, assetId: string) =>
  (await h.client.call('assets.get', { params: { assetId } })).asset

const real = (name: string, fn: () => Promise<void>) =>
  it(
    name,
    async (ctx) => {
      if (!media) return ctx.skip()
      await fn()
    },
    120_000,
  )

describe('editing a sheet with one instruction', () => {
  real(
    'uses the current image as the only reference and the instruction as the only prompt; new image becomes current, old stays in history',
    async () => {
      const { providers, h, projectId, hero } = await setup()
      await submit(h, projectId, { kind: 'asset_sheet', assetId: hero.id })
      await waitJobsIdle(h, projectId)
      const before = await sheetOf(h, hero.id)
      expect(before.sheet.versions).toHaveLength(1)
      const mark = providers.requests.length

      const res = await submit(h, projectId, {
        kind: 'asset_sheet',
        assetId: hero.id,
        editInstruction: '把头发改成红色',
      })
      expect(res.blocked).toEqual([])
      await waitJobsIdle(h, projectId)

      const after = await sheetOf(h, hero.id)
      expect(after.sheet.versions).toHaveLength(2)
      expect(after.sheet.versions[0]).toEqual(before.sheet.versions[0]) // 旧图原样留在历史里
      const fresh = after.sheet.versions[1]!
      expect(after.sheet.currentVersionId).toBe(fresh.id) // 新图成为当前版本
      expect(fresh.source).toBe('image_edit')
      expect(await h.server.ctx.files.exists(projectId, fresh.file.path)).toBe(true)

      // 发给模型的请求：一段文字 + 恰好一张参考图（就是旧的当前图）
      const call = providers.requests.slice(mark).find((r) => r.url.includes(':generateContent'))!
      const parts = (
        call.body as { contents: Array<{ parts: Array<{ text?: string; inline_data?: unknown }> }> }
      ).contents[0]!.parts
      expect(parts.filter((p) => p.inline_data)).toHaveLength(1)
      const prompt = parts.find((p) => p.text)!.text!
      expect(prompt).toContain('把头发改成红色')
      expect(prompt).not.toContain(hero.name) // 没有重新带上资产描述 / 名字
      expect(prompt).toContain('其余一律保持不变')

      // 任务面板里能看出这是“修改”
      const jobs = (await h.client.call('jobs.list', { query: { projectId } })).items
      expect(jobs.find((j) => j.id === res.succeeded[0]!.jobId)!.target).toMatchObject({
        kind: 'asset',
        assetId: hero.id,
        edit: true,
      })
    },
  )

  real("works on a variant sheet too (that variant's current image is the reference)", async () => {
    const { h, projectId, hero } = await setup()
    await h.client.call('variants.create', {
      params: { assetId: hero.id },
      body: { name: '雨天', description: '披着蓑衣' },
    })
    await submit(h, projectId, { kind: 'asset_sheet', assetId: hero.id })
    await waitJobsIdle(h, projectId)
    await submit(h, projectId, { kind: 'asset_sheet', assetId: hero.id, variantName: '雨天' })
    await waitJobsIdle(h, projectId)
    const before = (await sheetOf(h, hero.id)).variants.find((v) => v.name === '雨天')!
    expect(before.sheet.versions).toHaveLength(1)
    await submit(h, projectId, {
      kind: 'asset_sheet',
      assetId: hero.id,
      variantName: '雨天',
      editInstruction: '加上一把油纸伞',
    })
    await waitJobsIdle(h, projectId)
    const after = await sheetOf(h, hero.id)
    const variant = after.variants.find((v) => v.name === '雨天')!
    expect(variant.sheet.versions).toHaveLength(2)
    expect(variant.sheet.currentVersionId).toBe(variant.sheet.versions[1]!.id)
    expect(after.sheet.versions).toHaveLength(1) // 本体没动
  })

  real('a failed edit changes nothing', async () => {
    const { providers, h, projectId, hero } = await setup()
    await submit(h, projectId, { kind: 'asset_sheet', assetId: hero.id })
    await waitJobsIdle(h, projectId)
    const before = await sheetOf(h, hero.id)
    providers.faults.failImages = 1
    const res = await submit(h, projectId, {
      kind: 'asset_sheet',
      assetId: hero.id,
      editInstruction: '改成短发',
    })
    await waitJobsIdle(h, projectId, { allowFailed: true })
    const job = await h.client.call('jobs.get', { params: { jobId: res.succeeded[0]!.jobId } })
    expect(job.status).toBe('failed')
    const after = await sheetOf(h, hero.id)
    expect(after.sheet).toEqual(before.sheet) // 版本历史、当前版本都没动
    expect(after.updatedAt).toBe(before.updatedAt)
    expect(
      await h.server.ctx.store.artifacts.get(projectId, `asset_sheet:${hero.id}`),
    ).toMatchObject({ versionId: before.sheet.currentVersionId })
  })
})

describe('refused before anything is queued (same admission and preflight as any generation)', () => {
  real('no current image to edit / blank instruction / unknown variant', async () => {
    const { h, projectId, hero } = await setup()
    const noSheet = await preflight(h, projectId, {
      kind: 'asset_sheet',
      assetId: hero.id,
      editInstruction: '改成短发',
    })
    expect(noSheet.results[0]).toMatchObject({ status: 'blocked' })
    expect(noSheet.results[0]!.reasons.map((r) => r.code)).toContain('SHEET_TO_EDIT_MISSING')

    await submit(h, projectId, { kind: 'asset_sheet', assetId: hero.id })
    await waitJobsIdle(h, projectId)
    const blank = await preflight(h, projectId, {
      kind: 'asset_sheet',
      assetId: hero.id,
      editInstruction: '   ',
    })
    expect(blank.results[0]!.reasons.map((r) => r.code)).toContain('EDIT_INSTRUCTION_EMPTY')
    const noVariant = await preflight(h, projectId, {
      kind: 'asset_sheet',
      assetId: hero.id,
      variantName: '不存在',
      editInstruction: '改',
    })
    expect(noVariant.results[0]!.reasons.map((r) => r.code)).toContain('VARIANT_NOT_FOUND')
    // 空字符串在请求校验就被拒（客户端和服务端各校验一次）
    const rawEmpty = await h.raw(`/api/projects/${projectId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ target: { kind: 'asset_sheet', assetId: hero.id, editInstruction: '' } }],
      }),
    })
    expect(rawEmpty.status).toBe(400)

    const jobsBefore = (await h.client.call('jobs.list', { query: { projectId } })).items.length
    const res = await submit(h, projectId, {
      kind: 'asset_sheet',
      assetId: hero.id,
      editInstruction: '   ',
    })
    expect(res.succeeded).toEqual([])
    expect((await h.client.call('jobs.list', { query: { projectId } })).items).toHaveLength(
      jobsBefore,
    )
  })

  real(
    'a model without image-to-image is refused with the capability reason; nothing is queued',
    async () => {
      const { h, ids, projectId, hero } = await setup()
      await submit(h, projectId, { kind: 'asset_sheet', assetId: hero.id })
      await waitJobsIdle(h, projectId)
      await h.client.call('providers.update', {
        params: { providerId: ids.img! },
        body: { capabilityOverrides: { modes: { i2i: 'unsupported' } } },
      })
      const before = (await h.client.call('jobs.list', { query: { projectId } })).items.length
      const pre = await preflight(h, projectId, {
        kind: 'asset_sheet',
        assetId: hero.id,
        editInstruction: '改成短发',
      })
      expect(pre.results[0]).toMatchObject({ status: 'blocked' })
      expect(pre.results[0]!.reasons.length).toBeGreaterThan(0)
      const res = await submit(h, projectId, {
        kind: 'asset_sheet',
        assetId: hero.id,
        editInstruction: '改成短发',
      })
      expect(res.succeeded).toEqual([])
      expect(res.blocked).toHaveLength(1)
      expect((await h.client.call('jobs.list', { query: { projectId } })).items).toHaveLength(
        before,
      )
      // 普通生成（不带指令，文生图）不受影响
      expect(
        (await preflight(h, projectId, { kind: 'asset_sheet', assetId: hero.id })).results[0]!
          .status,
      ).not.toBe('blocked')
    },
  )

  real(
    'preflight is read-only and prices the edit; two edits of the same sheet cannot run at once',
    async () => {
      const { providers, h, projectId, hero } = await setup()
      await submit(h, projectId, { kind: 'asset_sheet', assetId: hero.id })
      await waitJobsIdle(h, projectId)
      const jobsBefore = (await h.client.call('jobs.list', { query: { projectId } })).items.length
      const pre = await preflight(h, projectId, {
        kind: 'asset_sheet',
        assetId: hero.id,
        editInstruction: '改成短发',
      })
      expect(pre.results[0]!.status).not.toBe('blocked')
      expect(pre.results[0]!.estimate).toBeDefined()
      expect((await h.client.call('jobs.list', { query: { projectId } })).items).toHaveLength(
        jobsBefore,
      )

      let release!: () => void
      providers.faults.imageGate = new Promise<void>((r) => (release = r))
      const first = await submit(h, projectId, {
        kind: 'asset_sheet',
        assetId: hero.id,
        editInstruction: '改成短发',
      })
      expect(first.succeeded).toHaveLength(1)
      const second = await submit(h, projectId, {
        kind: 'asset_sheet',
        assetId: hero.id,
        editInstruction: '换成长裙',
      })
      expect(second.succeeded).toEqual([])
      expect(second.failed).toHaveLength(1)
      release()
      await waitJobsIdle(h, projectId)
      expect((await sheetOf(h, hero.id)).sheet.versions).toHaveLength(2) // 只有一次修改落地
    },
  )
})
