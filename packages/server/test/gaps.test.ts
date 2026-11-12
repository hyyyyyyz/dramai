import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { createClient } from '@dramai/api'
import { deflateSync } from 'node:zlib'
import { cleanupAll, startServer } from './helpers.ts'
import type { Harness } from './helpers.ts'

afterEach(cleanupAll)

/** 一张真实可解析的 PNG（纯色，宽高可选）。 */
function png(width: number, height: number, shade = 128): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const v = new DataView(out.buffer)
    v.setUint32(0, data.length)
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
    out.set(data, 8)
    v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
    return out
  }
  const raw = new Uint8Array((width * 3 + 1) * height).fill(shade)
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, width)
  dv.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = 2
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]
  return Uint8Array.from(parts.flatMap((p) => [...p]))
}

const imageForm = (bytes: Uint8Array, name = 'ref.png', extra: Record<string, string> = {}) => {
  const f = new FormData()
  f.set('file', new File([Buffer.from(bytes)], name, { type: 'image/png' }))
  for (const [k, v] of Object.entries(extra)) f.set(k, v)
  return f
}

const failure = async <T>(p: Promise<T>) =>
  p.then(
    () => undefined,
    (e) => e as { status: number; code: string; details?: unknown },
  )

async function newProject(h: Harness, body: Record<string, unknown> = {}) {
  return h.client.call('projects.create', {
    body: { name: 'p', aspectRatio: '9:16', ...body } as never,
  })
}

describe('1. jobs say what they are about (structured, not sentences)', () => {
  it('shots: episode number, position in the episode, project-wide number, title; assets: name, kind, variant; episode and project jobs', async () => {
    const h = await startServer({ startWorker: false })
    const p = await newProject(h)
    const e1 = await h.client.call('episodes.create', {
      params: { projectId: p.id },
      body: { title: '第一集' },
    })
    const e2 = await h.client.call('episodes.create', {
      params: { projectId: p.id },
      body: { title: '第二集' },
    })
    const s1 = await h.client.call('scenes.create', { params: { episodeId: e2.id }, body: {} })
    const sa = await h.client.call('shots.create', {
      params: { sceneId: s1.id },
      body: { title: '开场' },
    })
    const sb = await h.client.call('shots.create', { params: { sceneId: s1.id }, body: {} })
    const asset = await h.client.call('assets.create', {
      params: { projectId: p.id },
      body: { kind: 'character', name: '林夏' },
    })
    const q = h.server.ctx.queue
    await q.enqueue({ type: 'image', operation: 'shot_image', projectId: p.id, shotId: sb.id })
    await q.enqueue({ type: 'image', operation: 'shot_image', projectId: p.id, shotId: sa.id })
    await q.enqueue({
      type: 'image',
      operation: 'asset_sheet',
      projectId: p.id,
      assetId: asset.id,
      params: { target: { kind: 'asset_sheet', assetId: asset.id, variantName: '冬装' } },
    })
    await q.enqueue({ type: 'render', operation: 'compose', projectId: p.id, episodeId: e1.id })
    await q.enqueue({ type: 'text', operation: 'episodes_plan', projectId: p.id, paid: false })

    const { items } = await h.client.call('jobs.list', { query: { projectId: p.id } })
    const by = (op: string, pred: (j: (typeof items)[number]) => boolean = () => true) =>
      items.find((j) => j.operation === op && pred(j))!
    expect(by('shot_image', (j) => j.shotId === sa.id).target).toEqual({
      kind: 'shot',
      shotId: sa.id,
      shotIndex: 1,
      shotNumber: sa.number,
      shotTitle: '开场',
      sceneId: s1.id,
      episodeId: e2.id,
      episodeNumber: e2.number,
      episodeTitle: '第二集',
    })
    const second = by('shot_image', (j) => j.shotId === sb.id).target
    expect(second).toMatchObject({ kind: 'shot', shotIndex: 2, episodeNumber: e2.number })
    expect(second).not.toHaveProperty('shotTitle') // 没起标题就不带，前端自己写“第 2 个镜头”
    expect(by('asset_sheet').target).toEqual({
      kind: 'asset',
      assetId: asset.id,
      assetKind: 'character',
      name: '林夏',
      variantName: '冬装',
    })
    expect(by('compose').target).toEqual({
      kind: 'episode',
      episodeId: e1.id,
      episodeNumber: e1.number,
      episodeTitle: '第一集',
    })
    expect(by('episodes_plan').target).toEqual({ kind: 'project' })
    // 没有任何拼好的句子
    expect(JSON.stringify(items.map((j) => j.target))).not.toMatch(/生成|镜头图/)
  })

  it('a deleted target is reported as removed (the history stays readable); jobs.get and the SSE job.updated event carry the target too', async () => {
    const h = await startServer({ startWorker: false })
    const p = await newProject(h)
    const e = await h.client.call('episodes.create', { params: { projectId: p.id }, body: {} })
    const sc = await h.client.call('scenes.create', { params: { episodeId: e.id }, body: {} })
    const sh = await h.client.call('shots.create', { params: { sceneId: sc.id }, body: {} })

    const seen: Array<{ type: string; target?: unknown; job?: { id: string } }> = []
    h.server.ctx.bus.subscribe((b) => seen.push(b.event as never))
    const { job } = await h.server.ctx.queue.enqueue({
      type: 'image',
      operation: 'shot_image',
      projectId: p.id,
      shotId: sh.id,
    })
    await h.server.ctx.events.idle()
    const evt = seen.find((x) => x.type === 'job.updated' && x.job?.id === job.id)
    expect(evt?.target).toMatchObject({ kind: 'shot', shotId: sh.id, shotIndex: 1 })

    expect((await h.client.call('jobs.get', { params: { jobId: job.id } })).target).toMatchObject({
      kind: 'shot',
    })
    await h.server.ctx.queue.cancel(job.id)
    await h.client.call('shots.delete', { params: { shotId: sh.id } })
    expect((await h.client.call('jobs.get', { params: { jobId: job.id } })).target).toEqual({
      kind: 'removed',
      entity: 'shot',
      id: sh.id,
    })
  })
})

describe('2. reference-image project style', () => {
  it('upload → style becomes reference_image with the file readable through the file route', async () => {
    const h = await startServer({ startWorker: false })
    const p = await newProject(h)
    const bytes = png(8, 6)
    const out = await h.client.call('projects.setStyleReference', {
      params: { projectId: p.id },
      form: imageForm(bytes, 'moodboard.png', { label: '我的参考图' }),
    })
    expect(out.style).toMatchObject({
      source: 'reference_image',
      label: '我的参考图',
      description: '',
      imageKeywords: '',
    })
    const ref = out.style.referenceFile!
    expect(ref.path).toMatch(/^style\/reference-[0-9a-f]{12}\.png$/)
    expect(ref.mime).toBe('image/png')
    expect(ref.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    const file = await h.raw(`/api/projects/${p.id}/files/${ref.path}`)
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes)
    expect(
      (await h.client.call('projects.get', { params: { projectId: p.id } })).style.referenceFile
        ?.path,
    ).toBe(ref.path)
  })

  it('replacing the image removes the old file; renaming keeps the file; switching to another style removes it', async () => {
    const h = await startServer({ startWorker: false })
    const p = await newProject(h)
    const first = (
      await h.client.call('projects.setStyleReference', {
        params: { projectId: p.id },
        form: imageForm(png(8, 6, 40)),
      })
    ).style.referenceFile!
    const second = (
      await h.client.call('projects.setStyleReference', {
        params: { projectId: p.id },
        form: imageForm(png(10, 10, 200)),
      })
    ).style.referenceFile!
    expect(second.path).not.toBe(first.path)
    expect(await h.server.ctx.files.exists(p.id, first.path)).toBe(false)
    expect(await h.server.ctx.files.exists(p.id, second.path)).toBe(true)

    const renamed = await h.client.call('projects.update', {
      params: { projectId: p.id },
      body: { style: { source: 'reference_image', label: '改个名' } },
    })
    expect(renamed.style).toMatchObject({
      source: 'reference_image',
      label: '改个名',
      referenceFile: { path: second.path },
    })

    const swapped = await h.client.call('projects.update', {
      params: { projectId: p.id },
      body: { style: { source: 'template', templateId: 'cyberpunk' } },
    })
    expect(swapped.style.source).toBe('template')
    expect(swapped.style.referenceFile).toBeUndefined()
    expect(await h.server.ctx.files.exists(p.id, second.path)).toBe(false)
  })

  it('cannot choose reference_image without an uploaded image (create or update), and bad files are refused', async () => {
    const h = await startServer({ startWorker: false })
    const viaCreate = await failure(newProject(h, { style: { source: 'reference_image' } }))
    expect(viaCreate).toMatchObject({ status: 400, code: 'STYLE_REFERENCE_MISSING' })
    const p = await newProject(h)
    const viaUpdate = await failure(
      h.client.call('projects.update', {
        params: { projectId: p.id },
        body: { style: { source: 'reference_image' } },
      }),
    )
    expect(viaUpdate).toMatchObject({ status: 400, code: 'STYLE_REFERENCE_MISSING' })
    const notImage = await failure(
      h.client.call('projects.setStyleReference', {
        params: { projectId: p.id },
        form: imageForm(new TextEncoder().encode('not an image'), 'x.png'),
      }),
    )
    expect(notImage).toMatchObject({ status: 400 })
    const noFile = await failure(
      h.client.call('projects.setStyleReference', {
        params: { projectId: p.id },
        form: new FormData(),
      }),
    )
    expect(noFile).toMatchObject({ status: 400 })
    expect(
      (await h.client.call('projects.get', { params: { projectId: p.id } })).style.source,
    ).toBe('none')
  })
})

describe('3. adding an episode by hand', () => {
  it('appends with monotonic numbers, supports insertion before another episode and a default title', async () => {
    const h = await startServer({ startWorker: false })
    const p = await newProject(h)
    const a = await h.client.call('episodes.create', {
      params: { projectId: p.id },
      body: { title: ' 开篇 ', summary: '一句话概要' },
    })
    expect(a).toMatchObject({
      number: 1,
      title: '开篇',
      summary: '一句话概要',
      status: expect.any(String),
    })
    expect(a.progress.episodeId).toBe(a.id)
    const b = await h.client.call('episodes.create', { params: { projectId: p.id }, body: {} })
    expect(b).toMatchObject({ number: 2, title: '第 2 集' })
    const c = await h.client.call('episodes.create', {
      params: { projectId: p.id },
      body: { title: '插队', beforeEpisodeId: a.id },
    })
    const order = (await h.client.call('episodes.list', { params: { projectId: p.id } })).items.map(
      (x) => x.id,
    )
    expect(order).toEqual([c.id, a.id, b.id])
    // 编号发出去就不复用：删掉最后一集再加，号码继续往后
    await h.client.call('episodes.delete', { params: { episodeId: b.id } })
    expect(
      (await h.client.call('episodes.create', { params: { projectId: p.id }, body: {} })).number,
    ).toBe(4)
    expect(
      (await h.client.call('projects.get', { params: { projectId: p.id } })).counters.episode,
    ).toBe(4)
  })

  it('refuses an unknown beforeEpisodeId (nothing created) and a trashed or missing project', async () => {
    const h = await startServer({ startWorker: false })
    const p = await newProject(h)
    expect(
      await failure(
        h.client.call('episodes.create', {
          params: { projectId: p.id },
          body: { beforeEpisodeId: 'ep_nope' },
        }),
      ),
    ).toMatchObject({ status: 404, code: 'NOT_FOUND' })
    expect(
      (await h.client.call('episodes.list', { params: { projectId: p.id } })).items,
    ).toHaveLength(0)
    expect(
      await failure(h.client.call('episodes.create', { params: { projectId: 'nope' }, body: {} })),
    ).toMatchObject({ status: 404 })
  })

  it('concurrent creations get distinct numbers and all land in the order', async () => {
    const h = await startServer({ startWorker: false })
    const p = await newProject(h)
    const made = await Promise.all(
      Array.from({ length: 6 }, () =>
        h.client.call('episodes.create', { params: { projectId: p.id }, body: {} }),
      ),
    )
    expect(new Set(made.map((m) => m.number)).size).toBe(6)
    expect(
      (await h.client.call('episodes.list', { params: { projectId: p.id } })).items,
    ).toHaveLength(6)
  })
})

describe('5. built-in data speaks both languages; user text is returned as written', () => {
  const asLocale = (h: Harness, locale: string) =>
    createClient({ baseUrl: h.server.url, token: h.server.token, locale })

  it('style presets: zh by default, en by client option, header, query, settings, or Accept-Language (in that order)', async () => {
    const h = await startServer({ startWorker: false })
    const zh = await h.client.call('styles.list')
    expect(zh.groups[0]!.label).toBe('漫剧 / 动画')
    const en = await asLocale(h, 'en').call('styles.list')
    expect(en.groups[0]!.label).toBe('Anime / Animation')
    expect(
      en.groups.flatMap((g) => g.presets).find((x) => x.id === 'mystery_realistic'),
    ).toMatchObject({ label: 'Suspense realism' })
    // keywords are prompt material, never translated
    expect(en.groups[0]!.presets[0]!.imageKeywords).toBe(zh.groups[0]!.presets[0]!.imageKeywords)

    const raw = async (path: string, headers: Record<string, string> = {}) =>
      ((await (await h.raw(path, { headers })).json()) as typeof zh).groups[0]!.label
    expect(await raw('/api/styles?lang=en')).toBe('Anime / Animation')
    expect(await raw('/api/styles', { 'Accept-Language': 'en-US,en;q=0.9' })).toBe(
      'Anime / Animation',
    )
    expect(await raw('/api/styles', { 'Accept-Language': 'fr-FR,fr;q=0.9' })).toBe('漫剧 / 动画')
    // 应用设置里的界面语言，优先于浏览器的 Accept-Language
    const settings = await h.client.call('settings.get')
    await h.client.call('settings.update', { body: { ...settings, locale: 'en' } })
    expect(await raw('/api/styles', { 'Accept-Language': 'zh-CN' })).toBe('Anime / Animation')
    // 请求明确指定的最优先
    expect(await raw('/api/styles?lang=zh', { 'Accept-Language': 'en' })).toBe('漫剧 / 动画')
  })

  it('provider presets and configs made from them are translated; edited fields and hand-made configs are not', async () => {
    const h = await startServer({ startWorker: false })
    const en = asLocale(h, 'en')
    const presets = await en.call('presets.list')
    expect(JSON.stringify(presets)).not.toMatch(/[一-鿿]/)
    expect((await h.client.call('presets.list')).items[0]!.notes).toMatch(/[一-鿿]/)

    const made = await h.client.call('providers.fromPreset', {
      body: { presetId: presets.items[0]!.id },
    })
    expect(made.label).toMatch(/[一-鿿]/)
    const shown = await en.call('providers.get', { params: { providerId: made.id } })
    expect(shown.label).toBe(presets.items[0]!.label)
    expect(shown.notes).toBe(presets.items[0]!.notes)
    expect(shown.knownLimitations).toEqual(presets.items[0]!.knownLimitations)
    expect((await en.call('providers.list')).items[0]!.label).toBe(shown.label)

    await h.client.call('providers.update', {
      params: { providerId: made.id },
      body: { label: '我的 DeepSeek', notes: '自己写的备注' },
    })
    const edited = await en.call('providers.get', { params: { providerId: made.id } })
    expect(edited).toMatchObject({ label: '我的 DeepSeek', notes: '自己写的备注' })
    expect(edited.knownLimitations).toEqual(presets.items[0]!.knownLimitations) // 没改的限制仍翻译

    const handMade = await h.client.call('providers.create', {
      body: {
        label: '手填的',
        kind: 'llm',
        protocol: 'openai-chat',
        baseUrl: 'https://x.example',
        model: 'm',
        notes: '我的备注',
      },
    })
    expect(await en.call('providers.get', { params: { providerId: handMade.id } })).toMatchObject({
      label: '手填的',
      notes: '我的备注',
    })
  })

  it('project style label: built-in names are translated, a user-written style description is not', async () => {
    const h = await startServer({ startWorker: false })
    const en = asLocale(h, 'en')
    const tpl = await newProject(h, {
      style: { source: 'template', templateId: 'mystery_realistic' },
    })
    expect(tpl.style.label).toBe('悬疑写实')
    expect((await en.call('projects.get', { params: { projectId: tpl.id } })).style).toMatchObject({
      label: 'Suspense realism',
      description: expect.not.stringMatching(/[一-鿿]/),
    })
    const custom = await newProject(h, {
      style: { source: 'custom', description: '我自己描述的画风' },
    })
    expect(
      (await en.call('projects.get', { params: { projectId: custom.id } })).style,
    ).toMatchObject({ label: 'Custom', description: '我自己描述的画风' })
    const none = await newProject(h)
    expect((await en.call('projects.get', { params: { projectId: none.id } })).style.label).toBe(
      'Unspecified',
    )
    const list = await en.call('projects.list', { query: {} })
    expect(list.items.find((x) => x.id === tpl.id)!.style.label).toBe('Suspense realism')
  })

  it('the demo notice comes in the requested language', async () => {
    const h = await startServer({
      startWorker: false,
      demo: { notice: { zh: '演示模式：不产生费用。', en: 'Demo mode: no charges.' } },
    })
    expect((await h.client.call('system.get')).demo).toEqual({
      active: true,
      notice: '演示模式：不产生费用。',
    })
    expect((await asLocale(h, 'en').call('system.get')).demo).toEqual({
      active: true,
      notice: 'Demo mode: no charges.',
    })
    const plain = await startServer({ startWorker: false })
    expect((await plain.client.call('system.get')).demo).toEqual({ active: false })
  })
})
