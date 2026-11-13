import { describe, expect, it } from 'vitest'
import { loadCatalog } from '../src/data-dir.ts'
import { localeFromAcceptLanguage, normalizeLocale, pick } from '../src/i18n.ts'
import {
  expandStyle,
  localizeStyleGroup,
  localizeStylePreset,
  localizeStyleSnapshot,
} from '../src/prompts/styles.ts'
import {
  localizeProviderConfig,
  localizeProviderPreset,
  PROVIDER_PRESETS,
  configFromPreset,
} from '../src/providers/presets.ts'

const catalog = loadCatalog()
const hasCjk = (s: string) => /[一-鿿]/.test(s)

describe('locale parsing', () => {
  it('maps Traditional Chinese tags (by script or region) to zh-Hant and the rest of Chinese to zh', () => {
    for (const tag of [
      'zh-TW',
      'zh_TW',
      'zh-HK',
      'zh-MO',
      'zh-Hant',
      'zh-Hant-TW',
      'zh-Hant-HK',
      'ZH-tw',
      'zh-hant-cn',
    ]) {
      expect(normalizeLocale(tag), tag).toBe('zh-Hant')
    }
    for (const tag of ['zh', 'zh-CN', 'zh-SG', 'zh-Hans', 'zh-Hans-CN', 'zh-Hans-TW', 'zh_cn']) {
      expect(normalizeLocale(tag), tag).toBe('zh')
    }
    expect(localeFromAcceptLanguage('zh-TW,zh;q=0.9,en;q=0.8')).toBe('zh-Hant')
    expect(localeFromAcceptLanguage('en;q=0.8,zh-CN;q=0.9')).toBe('zh')
    expect(localeFromAcceptLanguage('fr,zh-HK;q=0.5')).toBe('zh-Hant')
    expect(pick({ zh: '视频', 'zh-Hant': '影片' }, 'zh-Hant')).toBe('影片')
    expect(pick({ zh: '视频', en: 'video' }, 'zh-Hant')).toBe('视频') // no translation: source text
  })

  it('normalizes language tags and Accept-Language', () => {
    expect(normalizeLocale('zh-CN')).toBe('zh')
    expect(normalizeLocale('EN-us')).toBe('en')
    expect(normalizeLocale('fr')).toBeUndefined()
    expect(normalizeLocale('')).toBeUndefined()
    expect(localeFromAcceptLanguage('fr-FR,fr;q=0.9,en;q=0.8')).toBe('en')
    expect(localeFromAcceptLanguage('zh-CN,zh;q=0.9,en;q=0.5')).toBe('zh')
    expect(localeFromAcceptLanguage('en;q=0.2, zh;q=0.9')).toBe('zh')
    expect(localeFromAcceptLanguage(undefined)).toBeUndefined()
    expect(pick({ zh: '中', en: 'en' }, 'en')).toBe('en')
    expect(pick({ zh: '中' }, 'en')).toBe('中')
  })
})

describe('built-in data is bilingual (nothing Chinese leaks into the English UI)', () => {
  it('every bundled style group and preset has English text with no Chinese in it', () => {
    for (const g of catalog.styles.groups) {
      expect(hasCjk(localizeStyleGroup(g, 'en')), g.id).toBe(false)
      for (const p of g.presets) {
        const t = localizeStylePreset(p, 'en')
        expect(hasCjk(t.label) || hasCjk(t.description), p.id).toBe(false)
        expect(t.label.length).toBeGreaterThan(0)
        // 中文仍是源语言
        expect(localizeStylePreset(p, 'zh').label).toBe(p.label)
      }
    }
  })

  it('every provider preset has English label / notes / limitations (same number of limitations)', () => {
    for (const p of PROVIDER_PRESETS) {
      const t = localizeProviderPreset(p, 'en')
      expect(hasCjk(t.label) || hasCjk(t.notes) || t.knownLimitations.some(hasCjk), p.id).toBe(
        false,
      )
      expect(t.knownLimitations).toHaveLength(p.knownLimitations.length)
    }
  })
})

// Characters that exist only in Simplified Chinese (each has a different Traditional form). A Traditional text that still
// contains one was converted carelessly or not at all. This is a guard, not a proof of correctness.
// (Only characters whose Traditional form differs: 器 is the same in both, 机器 -> 機器 is caught by 机.)
const SIMPLIFIED_ONLY = new Set(
  '视频画风动剧图设镜选悬经对验试费务码档实现创区热爱阳龙层开关发时间点电脑软连续项数据库网络线门义乐书买卖产亲仅从众优伤传体价儿党兰册写军农冲决况净减凤击则刚办励劳势单卫厂历压县参变叙叶号叹员团园围国圆圣场坏块坚备头夹奋奖妇妈学宁宝审寻导将尔尝尽属岁岛币师带帮并应庙废异弃张弹强归当录总恋恶悦惊惯愿戏战户扑执扩扫扬护报担拟拥择挥损换据摄摇数斗断无旧显晓术机杀杂权条来极构标栋树样桥检楼欢欧毕气汇汉汤没泽洁测济浓涂润温湾满灭灯灵灾炉炼烦烧焕爷牵独猎猪猫献玛疗盘监盖确礼离种积称穷竞笔筑签简类粮紧纠红约级纪纯纲纳纷纸纹练组细织终绍结绕绘给统继维缘缩罗习联肃脏脚艺节苏范获营虑虽补装见观规觉计订认讨让训议记讲许论访证评识词译诗话语误说请读课调谈谢负贡财责败账货质购贵贸资赛赞赢趋跃车轮转软轻载较辅辈输边过运还这进远违连迟适递遗鉴针钟钱铁银链销错锁长闪闭问闲间闹闻阅队际陆陈险随难静页顶顺须预领频题颜额饭饮饰馆马驶验骑鱼鲜鸟鸡麦黄齐齿龄',
)
// Mainland wording that Traditional-Chinese (Taiwan) readers would not use.
const MAINLAND_TERMS = [
  '視頻',
  '軟件',
  '默認',
  '項目',
  '信息',
  '文件夾',
  '服務器',
  '網絡',
  '質量',
  '激活',
  '賽博朋克',
  '蒸汽朋克',
  '短視頻',
]
const simplifiedLeak = (text: string) => [...text].filter((c) => SIMPLIFIED_ONLY.has(c))

describe('Traditional Chinese (zh-Hant) built-in data', () => {
  const texts = (): Array<[string, string]> => {
    const out: Array<[string, string]> = []
    for (const g of catalog.styles.groups) {
      out.push([`group ${g.id}`, localizeStyleGroup(g, 'zh-Hant')])
      for (const p of g.presets) {
        const t = localizeStylePreset(p, 'zh-Hant')
        out.push([`${p.id} label`, t.label], [`${p.id} description`, t.description])
      }
    }
    for (const p of PROVIDER_PRESETS) {
      const t = localizeProviderPreset(p, 'zh-Hant')
      out.push([`${p.id} label`, t.label], [`${p.id} notes`, t.notes])
      t.knownLimitations.forEach((l, i) => out.push([`${p.id} limitation ${i}`, l]))
    }
    return out
  }

  it('every style group / preset and provider preset is translated (not the Simplified fallback)', () => {
    for (const g of catalog.styles.groups) {
      expect(g.i18n?.['zh-Hant']?.label, g.id).toBeTruthy()
      for (const p of g.presets) {
        expect(p.i18n?.['zh-Hant']?.label, p.id).toBeTruthy()
        expect(p.i18n?.['zh-Hant']?.description, p.id).toBeTruthy()
      }
    }
    for (const p of PROVIDER_PRESETS) {
      const t = p.i18n?.['zh-Hant']
      expect(t, p.id).toBeDefined()
      expect(t!.knownLimitations).toHaveLength(p.knownLimitations.length)
    }
  })

  it('contains no Simplified-only characters and none of the Mainland-only wording', () => {
    expect(texts().length).toBeGreaterThan(50)
    for (const [where, text] of texts()) {
      expect(simplifiedLeak(text), `${where}: ${text}`).toEqual([])
      for (const term of MAINLAND_TERMS) expect(text, `${where} uses "${term}"`).not.toContain(term)
    }
    // the guard itself works
    expect(simplifiedLeak('视频')).toEqual(['视', '频'])
    expect(simplifiedLeak('影片')).toEqual([])
  })

  it('uses the Taiwan terms, and keeps ids, image keywords and product names untouched', () => {
    const style = (id: string) => catalog.styles.get(id)!
    expect(localizeStylePreset(style('vlog'), 'zh-Hant').label).toBe('Vlog / 短影音') // not 短視頻 / 短视频
    expect(localizeStylePreset(style('modern_drama'), 'zh-Hant').label).toBe('現代都會短劇') // 都市 -> 都會
    expect(localizeStylePreset(style('cyberpunk'), 'zh-Hant').label).toBe('Cyberpunk 賽博龐克') // 朋克 -> 龐克
    expect(localizeStylePreset(style('lyrical'), 'zh-Hant').description).toContain('底片') // 胶片 -> 底片
    const wan = PROVIDER_PRESETS.find((p) => p.id === '302-i2v-wan-flash')!
    expect(localizeProviderPreset(wan, 'zh-Hant').knownLimitations.join('')).toContain('影格') // 帧 -> 影格
    expect(/^[\u0020-\u007e]+$/.test(style('cyberpunk').imageKeywords)).toBe(true) // prompt material is never translated
    expect(localizeProviderPreset(wan, 'zh-Hant').notes).toContain('0.2 PTC')
  })

  it('built-in names of a stored style are translated, user-written text is not', () => {
    const custom = expandStyle(
      catalog.styles,
      { source: 'custom', description: '我自己描述的画风' },
      1,
    )
    const t = localizeStyleSnapshot(custom, catalog.styles, 'zh-Hant')
    expect(t.label).toBe('自定義')
    expect(t.description).toBe('我自己描述的画风') // the user's own words, even if Simplified
    expect(
      localizeStyleSnapshot(
        expandStyle(catalog.styles, { source: 'none' }, 1),
        catalog.styles,
        'zh-Hant',
      ).label,
    ).toBe('未指定')
    const tpl = expandStyle(
      catalog.styles,
      { source: 'template', templateId: 'mystery_realistic' },
      1,
    )
    expect(localizeStyleSnapshot(tpl, catalog.styles, 'zh-Hant').label).toBe('懸疑寫實')
    const preset = PROVIDER_PRESETS[0]!
    const cfg = configFromPreset(preset, { id: 'p1' })
    expect(localizeProviderConfig(cfg, 'zh-Hant').label).toBe(
      localizeProviderPreset(preset, 'zh-Hant').label,
    )
    expect(localizeProviderConfig({ ...cfg, label: '我的' }, 'zh-Hant').label).toBe('我的')
  })
})

describe('localizing stored copies: built-in text is translated, user text is returned as written', () => {
  const now = 1
  it('a template style snapshot shows the English preset name; an edited name stays', () => {
    const snap = expandStyle(
      catalog.styles,
      { source: 'template', templateId: 'mystery_realistic' },
      now,
    )
    expect(localizeStyleSnapshot(snap, catalog.styles, 'en')).toMatchObject({
      label: 'Suspense realism',
    })
    expect(localizeStyleSnapshot(snap, catalog.styles, 'zh')).toEqual(snap)
    const renamed = { ...snap, label: '我自己起的名字' }
    expect(localizeStyleSnapshot(renamed, catalog.styles, 'en').label).toBe('我自己起的名字')
    expect(localizeStyleSnapshot(snap, catalog.styles, 'en').imageKeywords).toBe(snap.imageKeywords)
  })

  it('"unspecified / custom / reference" labels are translated, the user-written custom description is not', () => {
    expect(
      localizeStyleSnapshot(
        expandStyle(catalog.styles, { source: 'none' }, now),
        catalog.styles,
        'en',
      ).label,
    ).toBe('Unspecified')
    const custom = expandStyle(
      catalog.styles,
      { source: 'custom', description: '我想要的颜色很淡' },
      now,
    )
    const en = localizeStyleSnapshot(custom, catalog.styles, 'en')
    expect(en.label).toBe('Custom')
    expect(en.description).toBe('我想要的颜色很淡')
  })

  it('a provider config made from a preset is translated field by field unless the user changed it', () => {
    const preset = PROVIDER_PRESETS[0]!
    const cfg = configFromPreset(preset, { id: 'p1' })
    const en = localizeProviderConfig(cfg, 'en')
    expect(hasCjk(en.label) || hasCjk(en.notes ?? '')).toBe(false)
    const edited = localizeProviderConfig(
      { ...cfg, label: '我的 DeepSeek', notes: '自己的备注' },
      'en',
    )
    expect(edited.label).toBe('我的 DeepSeek')
    expect(edited.notes).toBe('自己的备注')
    expect(edited.knownLimitations).toEqual(localizeProviderPreset(preset, 'en').knownLimitations)
    // 不是由预设创建的：原样
    expect(localizeProviderConfig({ label: '手填', notes: '备注' }, 'en')).toEqual({
      label: '手填',
      notes: '备注',
      knownLimitations: undefined,
    })
  })
})
