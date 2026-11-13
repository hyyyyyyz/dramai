import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { bundledDataDir, loadCatalog } from '../src/data-dir.ts'
import type { Catalog } from '../src/data-dir.ts'
import { createProject } from '../src/domain/index.ts'
import { PromptLibrary, PROMPT_SCHEMA_VERSION } from '../src/prompts/library.ts'
import { compileImagePrompt, compileVideoPrompt } from '../src/prompts/compile.ts'
import { expandStyle, StyleCatalog } from '../src/prompts/styles.ts'
import { buildStoryboardMessages } from '../src/prompts/storyboard.ts'
import {
  parseTemplate,
  renderNodes,
  TemplateError,
  templateVariables,
} from '../src/prompts/template.ts'
import {
  checkCapability,
  convertTotals,
  defaultCapability,
  estimateCost,
  loadModelRegistryFromDir,
  totalCosts,
} from '../src/providers/catalog.ts'
import { configFromPreset, PROVIDER_PRESETS } from '../src/providers/presets.ts'
import type { PromptDialect, ProviderConfig } from '../src/providers/types.ts'

let catalog: Catalog
beforeAll(() => {
  catalog = loadCatalog()
})

const tmpDirs: string[] = []
afterEach(async () => {
  while (tmpDirs.length) await rm(tmpDirs.pop()!, { recursive: true, force: true })
})
async function tmp() {
  const d = await mkdtemp(join(tmpdir(), 'dramai-data-'))
  tmpDirs.push(d)
  return d
}

describe('template engine', () => {
  const render = (
    src: string,
    vars: Record<string, unknown>,
    partials: Record<string, string> = {},
  ) =>
    renderNodes(parseTemplate(src), {
      vars,
      partial: (n) => (n in partials ? parseTemplate(partials[n]) : undefined),
    })

  it('substitutes variables, including dotted paths', () => {
    expect(render('Hi {{name}} / {{a.b}}', { name: '林夏', a: { b: 7 } })).toBe('Hi 林夏 / 7')
  })
  it('fails loudly on a missing variable instead of printing an empty string', () => {
    expect(() => render('{{nope}}', {})).toThrow(/missing template variable: nope/)
    expect(() => render('{{a.b}}', { a: {} })).toThrow(/a\.b/)
  })
  it('handles if / else / nesting with truthiness rules', () => {
    const src = '{{#if x}}X{{#if y}}Y{{else}}-y{{/if}}{{else}}no-x{{/if}}'
    expect(render(src, { x: 'a', y: '' })).toBe('X-y')
    expect(render(src, { x: 'a', y: ['z'] })).toBe('XY')
    expect(render(src, { x: '  ' })).toBe('no-x')
    expect(render(src, { x: [] })).toBe('no-x')
    expect(render('{{#if n}}1{{else}}0{{/if}}', { n: 0 })).toBe('0')
    expect(render('{{#if n}}1{{else}}0{{/if}}', {})).toBe('0') // if 的条件允许缺省
  })
  it('includes partials with the same variables, and reports unknown ones', () => {
    expect(render('A{{> p}}B', { v: 1 }, { p: '[{{v}}]' })).toBe('A[1]B')
    expect(() => render('{{> q}}', {})).toThrow(/unknown partial/)
  })
  it('ignores comments and rejects malformed templates', () => {
    expect(render('a{{! note }}b', {})).toBe('ab')
    expect(() => parseTemplate('{{#if x}}open')).toThrow(/unclosed/)
    expect(() => parseTemplate('{{/if}}')).toThrow(/unexpected/)
    expect(() => parseTemplate('{{#each x}}{{/each}}')).toThrow(/unsupported block/)
    expect(() => parseTemplate('{{else}}')).toThrow(TemplateError)
  })
  it('lists the variables a template uses', () => {
    expect(templateVariables(parseTemplate('{{a}} {{#if b}}{{c.d}}{{/if}}'))).toEqual([
      'a',
      'b',
      'c.d',
    ])
  })
})

describe('prompt library: data files loaded at runtime', () => {
  it('loads the bundled prompts with their metadata', () => {
    expect(catalog.prompts.ids()).toEqual([
      'assets.sheet.character',
      'assets.sheet.costume',
      'assets.sheet.edit',
      'assets.sheet.location',
      'assets.sheet.prop',
      'assets.variant.edit',
      'entities.extract.system',
      'entities.extract.user',
      'entities.merge.system',
      'entities.merge.user',
      'entities.variants.system',
      'entities.variants.user',
      'episodes.plan.system',
      'episodes.plan.user',
      'shots.breakdown.system',
      'shots.breakdown.user',
      'shots.frames.system',
      'shots.frames.user',
      'storyboard.system',
      'storyboard.user',
    ])
    expect(catalog.prompts.meta('storyboard.system')).toMatchObject({
      locale: 'zh',
      schemaVersion: PROMPT_SCHEMA_VERSION,
    })
    expect(catalog.prompts.has('storyboard.user')).toBe(true)
    expect(catalog.prompts.has('nope')).toBe(false)
  })

  it('parses front matter, falls back across locales and can be overridden by a later layer', () => {
    const lib = new PromptLibrary()
    lib.addSource('---\nid: greet\nlocale: zh\nschemaVersion: 1\n---\n你好 {{n}}', 'a.prompt')
    lib.addSource('---\nid: greet\nlocale: en\n---\nHello {{n}}', 'b.prompt')
    expect(lib.render('greet', { n: 'x' })).toBe('你好 x')
    expect(lib.render('greet', { n: 'x' }, { locale: 'en' })).toBe('Hello x')
    expect(lib.render('greet', { n: 'x' }, { locale: 'fr' })).toBe('你好 x') // 回退到 zh
    lib.addSource('---\nid: greet\nlocale: zh\n---\n用户覆盖 {{n}}', 'user.prompt')
    expect(lib.render('greet', { n: 'x' })).toBe('用户覆盖 x')
  })

  it('rejects unsupported schema versions and missing ids, naming the file', () => {
    const lib = new PromptLibrary()
    expect(() =>
      lib.addSource('---\nid: x\nschemaVersion: 99\n---\nbody', '/data/x.prompt'),
    ).toThrow(/x\.prompt.*schemaVersion 99/)
    expect(() => lib.addSource('---\nlocale: zh\n---\nbody', '/data/y.prompt')).toThrow(
      /y\.prompt.*"id"/,
    )
    expect(() => lib.addSource('---\nid: z\nbody', '/data/z.prompt')).toThrow(/not closed/)
    expect(() => lib.addSource('---\nid: z\n---\n{{#if a}}', '/data/w.prompt')).toThrow(/w\.prompt/)
  })

  it('names the file when rendering fails', () => {
    const lib = new PromptLibrary().addSource('---\nid: t\n---\n{{missing}}', '/data/t.prompt')
    expect(() => lib.render('t', {})).toThrow(
      /\/data\/t\.prompt: missing template variable: missing/,
    )
    expect(() => lib.render('unknown', {})).toThrow(/unknown prompt/)
  })

  it('merges user data directories on top of the bundled ones (prompts, models, styles)', async () => {
    const dir = await tmp()
    await mkdir(join(dir, 'prompts'))
    await mkdir(join(dir, 'models'))
    await writeFile(
      join(dir, 'prompts', 'sys.prompt'),
      '---\nid: storyboard.system\nlocale: zh\n---\n自定义系统提示 {{aspectRatio}} {{aspectHint}} {{styleKeywords}}',
      'utf8',
    )
    await writeFile(
      join(dir, 'models', 'mine.json'),
      JSON.stringify({
        schemaVersion: 1,
        models: [
          {
            id: 'wan2.2-i2v-flash',
            protocol: 'aliyun-video',
            apiModel: 'wan2.2-i2v-flash',
            displayName: 'override',
            capability: {
              ...defaultCapability('aliyun-video'),
              durations: { support: 'supported', value: { values: [5, 8] } },
            },
            pricing: [],
            prompt: { lang: 'zh', negative: 'none' },
            quirks: [],
            provenance: 'user',
          },
        ],
      }),
    )
    await writeFile(
      join(dir, 'styles.json'),
      JSON.stringify({
        schemaVersion: 1,
        groups: [
          {
            id: 'anime',
            label: '漫剧 / 动画',
            presets: [{ id: 'mine', label: '我的风格', description: 'd', imageKeywords: 'k' }],
          },
        ],
      }),
    )
    const merged = loadCatalog({ extraDirs: [dir] })
    expect(
      merged.prompts.render('storyboard.system', {
        aspectRatio: '9:16',
        aspectHint: 'h',
        styleKeywords: 'k',
      }),
    ).toContain('自定义系统提示')
    expect(merged.prompts.has('storyboard.user')).toBe(true) // 内置的仍在
    expect(
      merged.models.lookup({ protocol: 'aliyun-video', model: 'wan2.2-i2v-flash' }).capability
        .durations.value,
    ).toEqual({ values: [5, 8] })
    expect(merged.styles.get('mine')).toBeDefined()
    expect(merged.styles.get('shonen')).toBeDefined()
    expect(merged.styles.presets).toHaveLength(21)
    // 内置目录本身没有被改动
    expect(catalog.styles.presets).toHaveLength(20)
  })

  it('the model data schema accepts the openai-responses protocol, and unknown models on it get the conservative text default', async () => {
    const dir = await tmp()
    const base = catalog.models.all()[0]!
    await writeFile(
      join(dir, 'responses.json'),
      JSON.stringify({
        schemaVersion: 1,
        models: [
          {
            ...base,
            id: 'openai-responses-x',
            protocol: 'openai-responses',
            apiModel: 'gpt-x',
            displayName: 'GPT X',
          },
        ],
      }),
    )
    const registry = loadModelRegistryFromDir(dir)
    expect(registry.lookup({ protocol: 'openai-responses', model: 'gpt-x' }).declared).toBe(true)
    const unknown = catalog.models.lookup({ protocol: 'openai-responses', model: 'whatever' })
    expect(unknown.declared).toBe(false)
    expect(unknown.capability.modes).toEqual({}) // text model: no image / video modes
  })

  it('rejects malformed model data with a readable path', async () => {
    const dir = await tmp()
    await writeFile(
      join(dir, 'bad.json'),
      JSON.stringify({ schemaVersion: 1, models: [{ id: 'x' }] }),
    )
    expect(() => loadModelRegistryFromDir(dir)).toThrow(/bad\.json/)
    await writeFile(join(dir, 'bad.json'), JSON.stringify({ schemaVersion: 2, models: [] }))
    expect(() => loadModelRegistryFromDir(dir)).toThrow(/bad\.json/)
  })

  it('ships the data directory next to the package', () => {
    // a path with the platform's separators (on Windows `...\\data\\`)
    expect(bundledDataDir().replaceAll('\\', '/').endsWith('/data/')).toBe(true)
    expect(existsSync(join(bundledDataDir(), 'styles.json'))).toBe(true)
  })
})

describe('style presets: the 20 v0.4 presets as data', () => {
  it('loads 20 presets in 4 groups with unique ids', () => {
    expect(catalog.styles.presets).toHaveLength(20)
    expect(catalog.styles.groups.map((g) => [g.id, g.presets.length])).toEqual([
      ['anime', 5],
      ['realistic', 5],
      ['art', 5],
      ['thematic', 5],
    ])
    expect(new Set(catalog.styles.presets.map((p) => p.id)).size).toBe(20)
    for (const p of catalog.styles.presets) {
      expect(p.imageKeywords.length).toBeGreaterThan(10)
      expect(p.label.length).toBeGreaterThan(0)
    }
  })

  it('matches by label or id like v0.4', () => {
    expect(catalog.styles.match('少年热血漫风格')?.id).toBe('shonen')
    expect(catalog.styles.match('cyberpunk city')?.id).toBe('cyberpunk')
    expect(catalog.styles.match('')).toBeUndefined()
    expect(catalog.styles.match('随便写点什么')).toBeUndefined()
  })

  it('rejects duplicate ids', () => {
    expect(
      () =>
        new StyleCatalog([
          {
            id: 'g',
            label: 'g',
            presets: [
              { id: 'a', label: 'a', description: '', imageKeywords: 'k' },
              { id: 'a', label: 'b', description: '', imageKeywords: 'k' },
            ],
          },
        ]),
    ).toThrow(/duplicate/)
  })

  it('expands a choice into a snapshot at project creation; later template changes do not touch it', () => {
    const snap = expandStyle(catalog.styles, { source: 'template', templateId: 'xianxia' }, 123)
    expect(snap).toMatchObject({
      source: 'template',
      templateId: 'xianxia',
      label: '古风仙侠漫',
      expandedAt: 123,
    })
    expect(snap.imageKeywords).toContain('ink wash')
    const edited = catalog.styles.merged(
      new StyleCatalog([
        {
          id: 'anime',
          label: '漫剧 / 动画',
          presets: [
            { id: 'xianxia', label: '古风仙侠漫', description: 'x', imageKeywords: 'CHANGED' },
          ],
        },
      ]),
    )
    expect(edited.get('xianxia')?.imageKeywords).toBe('CHANGED')
    expect(snap.imageKeywords).toContain('ink wash') // 旧项目不变
    expect(() =>
      expandStyle(catalog.styles, { source: 'template', templateId: 'nope' }, 1),
    ).toThrow(/unknown style/)
  })

  it('template / reference image / custom / none are mutually exclusive in the snapshot', () => {
    const none = expandStyle(catalog.styles, { source: 'none' }, 1)
    expect(none).toMatchObject({ source: 'none', imageKeywords: '', description: '' })
    const custom = expandStyle(
      catalog.styles,
      { source: 'custom', description: '水墨风，少年热血漫' },
      1,
    )
    expect(custom).toMatchObject({ source: 'custom', description: '水墨风，少年热血漫' })
    expect(custom.templateId).toBeUndefined()
    const explicit = expandStyle(
      catalog.styles,
      { source: 'custom', description: 'x', imageKeywords: 'mine' },
      1,
    )
    expect(explicit.imageKeywords).toBe('mine')
    const ref = expandStyle(
      catalog.styles,
      {
        source: 'reference_image',
        referenceFile: { path: 'materials/s.png', mime: 'image/png', bytes: 1, sha256: 'a' },
      },
      1,
    )
    expect(ref).toMatchObject({ source: 'reference_image', imageKeywords: '', description: '' })
    expect(ref.referenceFile?.path).toBe('materials/s.png')
  })
})

describe('storyboard prompt (ported v0.4 prompt, now data)', () => {
  const project = (
    style = expandStyle(catalog.styles, { source: 'template', templateId: 'shonen' }, 1),
  ) =>
    createProject({
      id: 'p',
      name: '雨夜追凶',
      aspectRatio: '9:16',
      now: 1,
      style,
      summary: '一句话简介',
    })
  const base = (over: Partial<Parameters<typeof buildStoryboardMessages>[1]> = {}) => ({
    project: project(),
    materials: [{ name: '第一章', kind: 'txt' as const, text: '雨夜，她追着那个背影。' }],
    characters: [{ name: '林夏', description: '女主' }],
    userPrompt: '节奏紧凑',
    ...over,
  })

  it('produces a system and a user message with the contract, project, characters, materials and instruction', () => {
    const [sys, user] = buildStoryboardMessages(catalog.prompts, base())
    expect(sys.role).toBe('system')
    expect(user.role).toBe('user')
    expect(sys.content).toContain('{"shots": [...]}')
    expect(sys.content).toContain('scene_text')
    expect(sys.content).toContain('9:16')
    expect(sys.content).toContain('竖屏')
    expect(sys.content).toContain('shonen manga') // 风格关键词
    expect(user.content).toContain('雨夜追凶')
    expect(user.content).toContain('9:16')
    expect(user.content).toContain('- **林夏** · 女主')
    expect(user.content).toContain('### 素材1 《第一章》\n雨夜，她追着那个背影。')
    expect(user.content).toContain('节奏紧凑')
    expect(user.content).toContain('期望分镜数：6')
  })

  it('omits the style keyword block when no style is chosen', () => {
    const [sys, user] = buildStoryboardMessages(
      catalog.prompts,
      base({ project: project(expandStyle(catalog.styles, { source: 'none' }, 1)) }),
    )
    expect(sys.content).not.toContain('视觉基底关键词')
    expect(user.content).toContain('未指定，请按动漫通用风格自行判断')
  })

  it('clamps the shot count to 3..12', () => {
    expect(
      buildStoryboardMessages(catalog.prompts, base({ targetShotCount: 99 }))[1].content,
    ).toContain('期望分镜数：12')
    expect(
      buildStoryboardMessages(catalog.prompts, base({ targetShotCount: 1 }))[1].content,
    ).toContain('期望分镜数：3')
  })

  it('truncates each material at the limit (v0.4 behaviour, now configurable) and notes image references', () => {
    const [, user] = buildStoryboardMessages(
      catalog.prompts,
      base({
        materials: [
          { name: '长文', kind: 'txt', text: 'a'.repeat(5000) },
          { name: '参考.png', kind: 'image', text: '' },
        ],
        materialCharLimit: 100,
      }),
    )
    expect(user.content).toContain('a'.repeat(100) + '……(已截断)')
    expect(user.content).not.toContain('a'.repeat(101))
    expect(user.content).toContain('1. 参考.png')
  })

  it('handles empty characters, materials and instruction', () => {
    const [, user] = buildStoryboardMessages(
      catalog.prompts,
      base({ characters: [], materials: [], userPrompt: '  ' }),
    )
    expect(user.content).toContain('暂无角色卡')
    expect(user.content).toContain('无文档素材')
    expect(user.content).toContain('用户未提供额外指令')
  })

  it('every aspect ratio gets its own composition hint', () => {
    for (const [ratio, word] of [
      ['9:16', '竖屏'],
      ['16:9', '横屏'],
      ['1:1', '方形'],
    ] as const) {
      const p = createProject({ id: 'p', name: 'n', aspectRatio: ratio, now: 1 })
      expect(buildStoryboardMessages(catalog.prompts, base({ project: p }))[0].content).toContain(
        word,
      )
    }
  })
})

describe('prompt compiler: semantic slots vs model dialect (A17)', () => {
  const dialect = (over: Partial<PromptDialect> = {}): PromptDialect => ({
    lang: 'en',
    negative: 'field',
    ...over,
  })
  const ref = (index: number, assetName: string) => ({
    role: 'character' as const,
    index,
    assetName,
    file: { path: 'p', mime: 'image/png', bytes: 1, sha256: 'x' },
  })

  it('puts the style first, binds references by index at the end, and the floor sentence last', () => {
    const out = compileImagePrompt(
      {
        subject: 'a young woman in a red coat',
        action: 'turning to the camera',
        lighting: 'rim light',
        shotSize: 'CU',
        angle: 'low angle',
      },
      {
        dialect: dialect({ suffixFloor: ['No subtitles, no on-screen text, no watermark'] }),
        styleKeywords: 'anime style',
        references: [ref(1, 'Lin Xia'), ref(2, 'Teahouse')],
      },
    )
    expect(out.text.startsWith('anime style. CU, low angle')).toBe(true)
    expect(out.text).toContain('Image 1 is the reference for Lin Xia')
    expect(out.text).toContain('Image 2 is the reference for Teahouse')
    expect(out.text.endsWith('No subtitles, no on-screen text, no watermark')).toBe(true)
    expect(out.warnings).toEqual([])
  })

  it('uses the full English version when the dialect wants English', () => {
    const spec = { subject: '中文主体', fullEn: 'the full english description' }
    expect(compileImagePrompt(spec, { dialect: dialect({ lang: 'en' }) }).text).toBe(
      'the full english description',
    )
    expect(compileImagePrompt(spec, { dialect: dialect({ lang: 'zh' }) }).text).toBe('中文主体')
  })

  it('delivers negatives the way the model wants them', () => {
    const spec = { subject: 's', negative: ['no people in frame', 'no text'] }
    expect(compileImagePrompt(spec, { dialect: dialect({ negative: 'field' }) })).toMatchObject({
      text: 's',
      negative: 'no people in frame, no text',
    })
    const inline = compileImagePrompt(spec, { dialect: dialect({ negative: 'inline' }) })
    expect(inline.negative).toBeUndefined()
    expect(inline.text).toBe('s. Exclude: no people in frame, no text')
    const none = compileImagePrompt(spec, { dialect: dialect({ negative: 'none' }) })
    expect(none.text).toBe('s')
    expect(none.warnings.map((w) => w.code)).toEqual(['NEGATIVE_DROPPED'])
  })

  it('rejects an empty spec, warns on over-long prompts and on ignored fields', () => {
    expect(
      compileImagePrompt({ lighting: 'only light' }, { dialect: dialect() }).warnings[0].code,
    ).toBe('EMPTY_SPEC')
    const long = compileImagePrompt(
      { subject: 'x'.repeat(600) },
      { dialect: dialect({ recommendedMaxChars: 500 }) },
    )
    expect(long.warnings.map((w) => w.code)).toContain('PROMPT_TOO_LONG')
    expect(long.text.length).toBe(600) // 只告警，不截断
    const ignored = compileImagePrompt(
      { subject: 's', lens: '85mm' },
      { dialect: dialect({ ignores: ['lens'] }) },
    )
    expect(ignored.text).toBe('s')
    expect(ignored.warnings.map((w) => w.code)).toEqual(['IGNORED_FIELD'])
  })

  it('video: the single camera move comes first and the floor comes last', () => {
    const out = compileVideoPrompt(
      {
        openingState: '她站在门口',
        action: '她缓缓转身',
        secondary: '窗帘随风',
        cameraMove: '镜头缓慢推近',
        endState: '她看向窗外',
        soundIntent: '雨声',
      },
      { dialect: { lang: 'zh', negative: 'none', suffixFloor: ['避免出现字幕、画面文字、水印'] } },
    )
    expect(out.text.startsWith('镜头缓慢推近. 她站在门口. 她缓缓转身')).toBe(true)
    expect(out.text.endsWith('避免出现字幕、画面文字、水印')).toBe(true)
    expect(compileVideoPrompt({}, { dialect: dialect() }).warnings[0].code).toBe('EMPTY_SPEC')
  })

  it('is deterministic', () => {
    const spec = { subject: 'a', action: 'b' }
    const ctx = { dialect: dialect(), styleKeywords: 'k' }
    expect(compileImagePrompt(spec, ctx)).toEqual(compileImagePrompt(spec, ctx))
  })
})

describe('model profiles, capabilities and price table', () => {
  const lookup = (protocol: ProviderConfig['protocol'], model: string) =>
    catalog.models.lookup({ protocol, model })

  it('describes capabilities per model, as supported / unsupported / unverified — not booleans', () => {
    const flash = lookup('aliyun-video', 'wan2.2-i2v-flash')
    expect(flash.declared).toBe(true)
    expect(flash.capability).toMatchObject({
      media: 'video',
      verifiedAt: '2026-05-04',
      modes: { i2v: 'supported' },
      firstFrame: 'supported',
      lastFrame: 'unsupported',
      nativeAudio: 'unsupported',
      durations: { support: 'supported', value: { values: [5] } },
      resolutions: { support: 'supported', value: ['480P', '720P'] },
      refImages: { support: 'unsupported', value: 0 },
      aspectFromSource: true,
    })
    // 设计稿示例：Nano Banana 的参考图上限“未验证”——有一个声称的值，但不假装知道
    const banana = lookup('gemini-image', 'gemini-2.5-flash-image').capability
    expect(banana.modes).toEqual({ t2i: 'supported', i2i: 'unverified' })
    expect(banana.refImages).toMatchObject({ support: 'unverified', value: 3 })
    expect(banana.refImages.note).toContain('未在本项目验证')
    // Seedream：参考图不通 → i2i 不支持，参考图上限 0
    const seedream = lookup('openai-images', 'doubao-seedream-5-0-260128')
    expect(seedream.capability.modes).toEqual({ t2i: 'supported', i2i: 'unsupported' })
    expect(seedream.capability.refImages).toMatchObject({ support: 'unsupported', value: 0 })
    expect(seedream.profile?.quirks.join()).toContain('参考图')
    // 没跑过的型号：全部未验证，且没有 verifiedAt
    const seedance = lookup('volcengine-video', 'doubao-seedance-2-0-fast-260128').capability
    expect(seedance.verifiedAt).toBeUndefined()
    expect(seedance.modes).toEqual({ i2v: 'unverified' })
    expect(seedance.durations).toMatchObject({ support: 'unverified', value: { min: 4, max: 15 } })
    expect(seedance.nativeAudio).toBe('unverified')
  })

  it('verifiedAt is a date, present exactly on the models that were run end to end', () => {
    for (const p of catalog.models.all()) {
      const v = p.capability.verifiedAt
      if (v !== undefined) expect(v, p.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    const verified = catalog.models
      .all()
      .filter((p) => p.capability.verifiedAt)
      .map((p) => p.id)
    expect(verified.sort()).toEqual([
      'doubao-seedream-5-0-260128',
      'gemini-2.5-flash-image',
      'wan2.2-i2v-flash',
    ])
    // 凡是被标成 supported 的能力，所在画像必须有 verifiedAt
    for (const p of catalog.models.all()) {
      const c = p.capability
      const anySupported =
        Object.values(c.modes).includes('supported') ||
        [c.refImages, c.durations, c.resolutions, c.aspectRatios].some(
          (x) => x.support === 'supported',
        )
      if (anySupported) expect(c.verifiedAt, p.id).toBeDefined()
    }
  })

  it('every profile carries provenance, and resolution "none" means "do not send the parameter"', () => {
    for (const p of catalog.models.all()) {
      expect(p.provenance.length, p.id).toBeGreaterThan(5)
      expect(
        (p.capability.resolutions.value ?? []).every((r) => r !== ''),
        p.id,
      ).toBe(true)
    }
    expect(lookup('gemini-image', 'gemini-2.5-flash-image').capability.resolutions.value).toEqual([
      'none',
    ])
  })

  it('does not guess for unknown models: the primary mode is assumed, everything else is unverified; nothing is borrowed from a similar model', () => {
    const u = lookup('aliyun-video', 'wan9.9-unknown')
    expect(u.declared).toBe(false)
    expect(u.profile).toBeUndefined()
    expect(u.capability).toEqual(defaultCapability('aliyun-video'))
    expect(u.capability.modes).toEqual({ i2v: 'supported' })
    expect(u.capability.refImages.support).toBe('unverified')
    expect(u.capability.durations.support).toBe('unverified')
    expect(u.capability.verifiedAt).toBeUndefined()
    const over = catalog.models.lookup({
      protocol: 'aliyun-video',
      model: 'wan9.9-unknown',
      capabilityOverrides: { durations: { support: 'supported', value: { values: [6] } } },
    })
    expect(over.declared).toBe(true)
    expect(over.capability.durations.value).toEqual({ values: [6] })
  })

  it('checkCapability separates "unsupported" (blocks) from "unverified" (needs confirmation)', () => {
    const seedream = lookup('openai-images', 'doubao-seedream-5-0-260128')
    const issues = checkCapability(seedream, 'doubao-seedream-5-0-260128', {
      mode: 'i2i',
      referenceImages: 2,
      aspectRatio: '9:16',
    })
    expect(issues.map((i) => [i.code, i.level, i.key])).toEqual([
      ['MODE_UNSUPPORTED', 'unsupported', 'mode:i2i'],
      ['REFERENCE_NOT_SUPPORTED', 'unsupported', 'refImages'],
      ['ASPECT_UNSUPPORTED', 'unverified', 'aspectRatio'],
    ])
    expect(issues[1].message).toContain('doubao-seedream-5-0-260128')
    // 只检查这一次实际需要的能力：不带参考图的文生图不会因为“参考图未验证”被打扰
    const banana = lookup('gemini-image', 'gemini-2.5-flash-image')
    expect(checkCapability(banana, 'm', { mode: 't2i' })).toEqual([])
    expect(
      checkCapability(banana, 'm', { mode: 'i2i', referenceImages: 3 }).map((i) => [
        i.key,
        i.level,
      ]),
    ).toEqual([
      ['mode:i2i', 'unverified'],
      ['refImages', 'unverified'],
    ])
    const flash = lookup('aliyun-video', 'wan2.2-i2v-flash')
    expect(
      checkCapability(flash, 'm', {
        mode: 'i2v',
        firstFrame: true,
        resolution: '720P',
        durationSec: 5,
      }),
    ).toEqual([])
    // 已声明支持的分辨率清单里没有的 → 不支持（而不是未验证）
    expect(
      checkCapability(flash, 'm', { resolution: '1080P' }).map((i) => [i.code, i.level]),
    ).toEqual([['RESOLUTION_UNSUPPORTED', 'unsupported']])
    expect(checkCapability(flash, 'm', { lastFrame: true }).map((i) => [i.code, i.level])).toEqual([
      ['LAST_FRAME_UNSUPPORTED', 'unsupported'],
    ])
    // 画幅跟随起始帧的模型不检查比例
    const narrow = {
      ...flash,
      capability: {
        ...flash.capability,
        aspectRatios: { support: 'supported' as const, value: ['16:9' as const] },
      },
    }
    expect(checkCapability(narrow, 'm', { aspectRatio: '9:16' })).toEqual([])
    // 未验证的时长档
    const plus = lookup('aliyun-video', 'wan2.2-i2v-plus')
    expect(checkCapability(plus, 'm', { durationSec: 8 }).map((i) => [i.key, i.level])).toEqual([
      ['duration', 'unverified'],
    ])
  })

  it('estimates cost from the price table; unknown prices are reported as unpriced, never guessed', () => {
    const flash = lookup('aliyun-video', 'wan2.2-i2v-flash').profile
    expect(estimateCost(flash, { seconds: 5, resolution: '720P' })).toEqual({
      priced: true,
      currency: 'PTC',
      amount: 0.2,
      approx: false,
    })
    expect(estimateCost(flash, { seconds: 5, resolution: '480P' })).toMatchObject({ amount: 0.1 })
    expect(estimateCost(flash, { seconds: 5, count: 6, resolution: '720P' })).toMatchObject({
      amount: 1.2,
    }) // 预设备注：6 个分镜 ≈ 1.2 PTC
    expect(estimateCost(flash, { seconds: 5 })).toMatchObject({ priced: false }) // 没给分辨率就不猜
    expect(estimateCost(flash, { resolution: '720P' })).toMatchObject({ priced: false }) // 按秒计价但没给时长
    expect(estimateCost(flash, { seconds: 5, resolution: '1080P' })).toMatchObject({
      priced: false,
    })
    const banana = lookup('gemini-image', 'gemini-2.5-flash-image').profile
    expect(estimateCost(banana, { count: 2 })).toEqual({
      priced: true,
      currency: 'PTC',
      amount: 0.7,
      range: [0.4, 1],
      approx: true,
    })
    expect(
      estimateCost(lookup('volcengine-video', 'doubao-seedance-2-0-fast-260128').profile, {
        seconds: 5,
        resolution: '720p',
      }),
    ).toMatchObject({ priced: false })
    expect(estimateCost(undefined, {})).toMatchObject({ priced: false })
    expect(
      estimateCost(lookup('openai-images', 'doubao-seedream-5-0-260128').profile, { count: 6 }),
    ).toMatchObject({ priced: true, amount: 0.21 })
  })
})

describe('provider presets', () => {
  it('keeps the four v0.4 presets, tested, with their notes intact', () => {
    expect(
      PROVIDER_PRESETS.filter((p) => p.verification.status === 'tested').map((p) => p.id),
    ).toEqual(['deepseek-llm', '302-image-seedream', '302-image-nano-banana', '302-i2v-wan-flash'])
    for (const p of PROVIDER_PRESETS.filter((x) => x.verification.status === 'tested')) {
      expect(p.verification).toEqual({ status: 'tested', testedAt: '2026-05-04' })
      expect(p.auth).toEqual({ type: 'api_key' })
    }
    const byId = Object.fromEntries(PROVIDER_PRESETS.map((p) => [p.id, p]))
    expect(byId['302-image-seedream'].notes).toContain('locked character 参考图当前不通')
    expect(byId['302-image-nano-banana'].notes).toContain('base URL 不带 /v1')
    expect(byId['302-i2v-wan-flash'].notes).toContain('性价比之王')
    expect(byId['deepseek-llm'].notes).toContain('验证 2026-05')
    expect(byId['302-i2v-wan-flash']).toMatchObject({
      baseUrl: 'https://api.302ai.cn',
      suggestedModel: 'wan2.2-i2v-flash',
      protocol: 'aliyun-video',
      kind: 'video',
    })
  })

  it('every preset has a verification status (tested with a date, or documented with a source) and known limitations', () => {
    for (const p of PROVIDER_PRESETS) {
      if (p.verification.status === 'tested') {
        expect(p.verification.testedAt, p.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(p.verifiedAt, p.id).toBe(p.verification.testedAt)
      } else {
        expect(p.verification.source, p.id).toMatch(/^https:\/\//)
        expect(p.verifiedAt, p.id).toBeUndefined() // an untested preset never carries a test date
      }
      expect(p.knownLimitations.length, p.id).toBeGreaterThan(0)
    }
  })

  it('the OpenAI sign-in preset is documented-only, text-only, and says what it does not cover', () => {
    const p = PROVIDER_PRESETS.find((x) => x.id === 'openai-responses-login')!
    expect(p).toMatchObject({
      kind: 'llm',
      protocol: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
      auth: { type: 'account_login', channel: 'openai-chatgpt' },
      verification: { status: 'documented' },
    })
    expect(p.knownLimitations[0]).toContain('只覆盖文本，不含生图、视频和语音')
    expect(p.knownLimitations.join('')).toContain('ChatGPT 订阅')
    const cfg = configFromPreset(p, { id: 'c1' })
    expect(cfg).toMatchObject({ auth: p.auth, verification: p.verification })
    expect(cfg.verifiedAt).toBeUndefined()
    expect(cfg.secretRef).toBeUndefined()
  })

  it('every media preset points at a model that has a profile', () => {
    for (const p of PROVIDER_PRESETS.filter((x) => x.kind !== 'llm')) {
      expect(
        catalog.models.lookup({ protocol: p.protocol, model: p.suggestedModel }).declared,
        p.id,
      ).toBe(true)
    }
  })

  it('a config made from a preset never contains an API key', () => {
    const cfg = configFromPreset(PROVIDER_PRESETS[0], { id: 'cfg1', secretRef: 'secret:cfg1' })
    expect(cfg).toMatchObject({
      id: 'cfg1',
      presetId: 'deepseek-llm',
      protocol: 'openai-chat',
      enabled: true,
      secretRef: 'secret:cfg1',
    })
    expect(Object.keys(cfg)).not.toContain('apiKey')
    expect(JSON.stringify(cfg)).not.toMatch(/sk-/)
  })
})

describe('prices keep the provider currency; conversion is an optional user setting', () => {
  const lookupP = (protocol: ProviderConfig['protocol'], model: string) =>
    catalog.models.lookup({ protocol, model }).profile
  const flash = () => lookupP('aliyun-video', 'wan2.2-i2v-flash')
  const banana = () => lookupP('gemini-image', 'gemini-2.5-flash-image')
  const priced = (currency: string, amount: number, range?: [number, number]) => ({
    priced: true as const,
    currency,
    amount,
    approx: range !== undefined,
    range,
  })

  it('stores the provider’s original unit and currency (PTC points), without a hidden exchange rate', () => {
    for (const p of catalog.models.all()) {
      for (const price of p.pricing) {
        expect(price.currency, p.id).toBe('PTC')
        expect(['per_image', 'per_second', 'per_call', 'per_1k_chars']).toContain(price.unit)
      }
    }
    const e = estimateCost(flash(), { seconds: 5, resolution: '720P' })
    expect(e).toMatchObject({ priced: true, currency: 'PTC' }) // 不是 CNY
  })

  it('totals different currencies separately — they are never added together', () => {
    const totals = totalCosts([
      priced('PTC', 1.2),
      priced('PTC', 0.3),
      priced('USD', 2),
      { priced: false, reason: 'x' },
    ])
    expect(totals).toEqual({
      byCurrency: { PTC: { amount: 1.5, approx: false }, USD: { amount: 2, approx: false } },
      unpriced: 1,
    })
  })

  it('carries ranges and the "approximate" flag through the totals', () => {
    const t = totalCosts([
      estimateCost(banana(), { count: 2 }),
      estimateCost(banana(), { count: 1 }),
    ])
    expect(t.byCurrency.PTC.amount).toBeCloseTo(1.05, 6)
    expect(t.byCurrency.PTC.range?.[0]).toBeCloseTo(0.6, 6)
    expect(t.byCurrency.PTC.range?.[1]).toBeCloseTo(1.5, 6)
    expect(t.byCurrency.PTC.approx).toBe(true)
    // 一部分有区间、一部分没有：没有区间的按点估值计入上下界
    const mixed = totalCosts([estimateCost(banana(), { count: 1 }), priced('PTC', 0.035)])
    expect(mixed.byCurrency.PTC.range?.[0]).toBeCloseTo(0.235, 6)
    expect(mixed.byCurrency.PTC.range?.[1]).toBeCloseTo(0.535, 6)
  })

  it('does NOT convert by default', () => {
    const totals = totalCosts([priced('PTC', 1.2)])
    expect(convertTotals(totals)).toEqual({
      remaining: { PTC: { amount: 1.2, approx: false } },
      unpriced: 0,
      isEstimate: true,
    })
    expect(convertTotals(totals, {}).converted).toBeUndefined()
  })

  it('converts with a user-set rate, keeps currencies without a rate separate, and always flags an estimate', () => {
    const totals = totalCosts([
      priced('PTC', 1.2),
      priced('USD', 2),
      priced('CNY', 3),
      { priced: false, reason: 'x' },
    ])
    const out = convertTotals(totals, { conversion: { targetCurrency: 'CNY', rates: { PTC: 7 } } })
    expect(out.converted).toMatchObject({ currency: 'CNY', approx: true })
    expect(out.converted?.amount).toBeCloseTo(1.2 * 7 + 3, 6) // 目标币种自身按 1:1
    expect(out.remaining).toEqual({ USD: { amount: 2, approx: false } }) // 没有汇率的不猜
    expect(out.unpriced).toBe(1)
    expect(out.isEstimate).toBe(true)
  })

  it('converts ranges and ignores non-positive rates', () => {
    const t = totalCosts([estimateCost(banana(), { count: 1 })])
    const out = convertTotals(t, { conversion: { targetCurrency: 'CNY', rates: { PTC: 7 } } })
    expect(out.converted?.range?.[0]).toBeCloseTo(1.4, 6)
    expect(out.converted?.range?.[1]).toBeCloseTo(3.5, 6)
    const bad = convertTotals(t, { conversion: { targetCurrency: 'CNY', rates: { PTC: 0 } } })
    expect(bad.converted).toBeUndefined()
    expect(bad.remaining.PTC).toBeDefined()
  })
})
