import { afterEach, describe, expect, it } from 'vitest'
import { createClient } from '@dramai/api'
import { cleanupAll, startServer } from './helpers.ts'
import type { Harness } from './helpers.ts'

afterEach(cleanupAll)

const as = (h: Harness, locale: string) =>
  createClient({ baseUrl: h.server.url, token: h.server.token, locale })

describe('Traditional Chinese for built-in data (zh-Hant)', () => {
  it('is chosen by zh-TW / zh-HK / zh-Hant from the client option, the query, the header, the app setting or Accept-Language', async () => {
    const h = await startServer({ startWorker: false })
    const first = async (path: string, headers: Record<string, string> = {}) =>
      ((await (await h.raw(path, { headers })).json()) as { groups: Array<{ label: string }> })
        .groups[0]!.label
    expect((await h.client.call('styles.list')).groups[0]!.label).toBe('漫剧 / 动画') // default: Simplified
    for (const tag of ['zh-TW', 'zh-Hant', 'zh-HK', 'zh_TW']) {
      expect((await as(h, tag).call('styles.list')).groups[0]!.label, tag).toBe('漫劇 / 動畫')
    }
    expect((await as(h, 'zh-CN').call('styles.list')).groups[0]!.label).toBe('漫剧 / 动画')
    expect(await first('/api/styles?lang=zh-TW')).toBe('漫劇 / 動畫')
    expect(await first('/api/styles', { 'X-Dramai-Locale': 'zh-Hant' })).toBe('漫劇 / 動畫')
    expect(await first('/api/styles', { 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8' })).toBe(
      '漫劇 / 動畫',
    )
    expect(await first('/api/styles', { 'Accept-Language': 'zh-CN,zh;q=0.9' })).toBe('漫剧 / 动画')
    // the UI language in the app settings beats the browser's Accept-Language
    const settings = await h.client.call('settings.get')
    await h.client.call('settings.update', { body: { ...settings, locale: 'zh-TW' } })
    expect(await first('/api/styles', { 'Accept-Language': 'en' })).toBe('漫劇 / 動畫')
    expect(await first('/api/styles?lang=en', {})).toBe('Anime / Animation') // an explicit request still wins
  })

  it('style presets, provider presets and the configs made from them', async () => {
    const h = await startServer({ startWorker: false })
    const hant = as(h, 'zh-TW')
    const styles = await hant.call('styles.list')
    expect(styles.groups.flatMap((g) => g.presets).find((p) => p.id === 'vlog')).toMatchObject({
      label: 'Vlog / 短影音',
    })
    const zhStyles = await h.client.call('styles.list')
    // prompt material is the same in every language
    expect(styles.groups[0]!.presets[0]!.imageKeywords).toBe(
      zhStyles.groups[0]!.presets[0]!.imageKeywords,
    )

    const presets = await hant.call('presets.list')
    const wan = presets.items.find((p) => p.id === '302-i2v-wan-flash')!
    expect(wan.knownLimitations.join('')).toContain('影格')
    expect(JSON.stringify(presets)).not.toContain('视频')

    const made = await h.client.call('providers.fromPreset', { body: { presetId: wan.id } })
    expect(made.label).toContain('通义万相') // stored in Simplified (the source)
    const shown = await hant.call('providers.get', { params: { providerId: made.id } })
    expect(shown).toMatchObject({
      label: wan.label,
      notes: wan.notes,
      knownLimitations: wan.knownLimitations,
    })
    await h.client.call('providers.update', {
      params: { providerId: made.id },
      body: { label: '我的万相' },
    })
    expect((await hant.call('providers.get', { params: { providerId: made.id } })).label).toBe(
      '我的万相',
    ) // user text untouched
  })

  it('project style names and the demo notice', async () => {
    const h = await startServer({
      startWorker: false,
      demo: { notice: { zh: '演示模式（简）', 'zh-Hant': '演示模式（繁）', en: 'Demo (en)' } },
    })
    const hant = as(h, 'zh-TW')
    const tpl = await h.client.call('projects.create', {
      body: {
        name: 'p',
        aspectRatio: '9:16',
        style: { source: 'template', templateId: 'cyberpunk' },
      },
    })
    expect((await hant.call('projects.get', { params: { projectId: tpl.id } })).style.label).toBe(
      'Cyberpunk 賽博龐克',
    )
    const custom = await h.client.call('projects.create', {
      body: {
        name: 'q',
        aspectRatio: '9:16',
        style: { source: 'custom', description: '我的风格' },
      },
    })
    expect(
      (await hant.call('projects.get', { params: { projectId: custom.id } })).style,
    ).toMatchObject({ label: '自定義', description: '我的风格' })
    expect((await hant.call('system.get')).demo.notice).toBe('演示模式（繁）')
    expect((await h.client.call('system.get')).demo.notice).toBe('演示模式（简）')
    expect((await as(h, 'en').call('system.get')).demo.notice).toBe('Demo (en)')
  })
})
