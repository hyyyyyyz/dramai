import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bundledDataDir, loadCatalog } from '../src/data-dir.ts'
import { parseTemplate, templateVariables } from '../src/prompts/template.ts'
import { buildSheetPrompt, buildVariantEditPrompt } from '../src/pipeline/sheets.ts'

const dir = join(bundledDataDir(), 'prompts')
const files = (d: string): string[] =>
  readdirSync(d).flatMap((n) =>
    statSync(join(d, n)).isDirectory() ? files(join(d, n)) : [join(d, n)],
  )
const all = files(dir).filter((f) => f.endsWith('.prompt') && !f.includes('/partials/'))

describe('prompt data files', () => {
  it('every prompt is a data file with id, locale and schemaVersion, and the id matches the file name', () => {
    expect(all.length).toBeGreaterThanOrEqual(19)
    for (const f of all) {
      const text = readFileSync(f, 'utf8')
      const front = /^---\n([\s\S]*?)\n---\n/.exec(text)
      expect(front, f).not.toBeNull()
      const id = /^id:\s*(.+)$/m.exec(front![1])?.[1]
      expect(f.split('/').pop()!.startsWith(`${id}.`), f).toBe(true)
      expect(front![1], f).toMatch(/^schemaVersion:\s*1$/m)
      expect(front![1], f).toMatch(/^locale:\s*zh$/m)
      expect(front![1], f).toMatch(/^description:\s*\S/m)
    }
  })

  it('every template parses, and only uses variables the pipeline actually supplies', () => {
    const supplied: Record<string, string[]> = {
      'episodes.plan.system': ['targetChars'],
      'episodes.plan.user': [
        'projectName',
        'firstChapter',
        'lastChapter',
        'hasMore',
        'previousBlock',
        'userInstructions',
        'tocBlock',
      ],
      'shots.breakdown.system': [
        'targetShotsMin',
        'targetShotsMax',
        'styleLabel',
        'aspectRatio',
        'aspectHint',
      ],
      'shots.breakdown.user': [
        'projectName',
        'episodeNumber',
        'episodeTitle',
        'partLabel',
        'assetsBlock',
        'previousBlock',
        'userInstructions',
        'charCount',
        'sourceText',
      ],
      'entities.extract.system': [],
      'entities.extract.user': ['projectName', 'styleLabel', 'shotsBlock'],
      'entities.merge.system': [],
      'entities.merge.user': ['libraryBlock', 'groupsBlock'],
      'entities.variants.system': [],
      'entities.variants.user': ['charactersBlock'],
      'shots.frames.system': ['aspectRatio', 'styleLabel'],
      'shots.frames.user': ['styleKeywords', 'shotsBlock'],
      'assets.variant.edit': ['instruction', 'hasCostumeRef'],
      'assets.sheet.edit': ['instruction'],
      'storyboard.system': ['aspectRatio', 'aspectHint', 'styleKeywords'],
      'storyboard.user': [
        'projectName',
        'styleLine',
        'aspectRatio',
        'summary',
        'shotCount',
        'charactersBlock',
        'materialsBlock',
        'imageHint',
        'userPrompt',
      ],
    }
    for (const kind of ['character', 'location', 'prop', 'costume']) {
      supplied[`assets.sheet.${kind}`] = [
        'name',
        'appearance',
        'styleKeywords',
        'multiView',
        'viewName',
        'originalsHint',
        'wantsExclusion',
      ]
    }
    for (const f of all) {
      const text = readFileSync(f, 'utf8')
      const id = /^id:\s*(.+)$/m.exec(text)![1]
      const body = text.replace(/^---\n[\s\S]*?\n---\n/, '')
      const vars = templateVariables(parseTemplate(body))
      expect(supplied[id], `no variable list for ${id}`).toBeDefined()
      for (const v of vars) expect(supplied[id], `${id} uses {{${v}}}`).toContain(v)
    }
  })

  it('all four sheet templates render for their asset kind (character, location, prop, costume) and the variant edit template renders', () => {
    const { prompts } = loadCatalog()
    const style = { imageKeywords: 'anime style' }
    const base = {
      name: '甲',
      appearance: '外观描述',
      styling: undefined,
      description: undefined,
      originals: [],
    }
    const char = buildSheetPrompt(prompts, { ...base, kind: 'character' }, style, 'multi_view')
    expect(char).toContain('画风：anime style')
    expect(char).toContain('正面、90 度侧面、背面')
    expect(char).toContain('一致性优先于好看')
    const front = buildSheetPrompt(
      prompts,
      { ...base, kind: 'character' },
      style,
      'per_angle',
      'side',
    )
    expect(front).toContain('90 度侧面全身像')
    expect(front).not.toContain('并排画出')
    expect(buildSheetPrompt(prompts, { ...base, kind: 'location' }, style, 'single')).toContain(
      '没有任何人物',
    )
    expect(buildSheetPrompt(prompts, { ...base, kind: 'prop' }, style, 'single')).toContain(
      '只呈现这一件物品本体',
    )
    expect(buildSheetPrompt(prompts, { ...base, kind: 'costume' }, style, 'single')).toContain(
      '人台',
    )
    expect(
      buildSheetPrompt(
        prompts,
        { ...base, kind: 'character' },
        { imageKeywords: '' },
        'multi_view',
      ),
    ).not.toContain('画风：')
    expect(buildVariantEditPrompt(prompts, '换上红色嫁衣', true)).toContain(
      '第二张参考图是这件服装',
    )
    expect(buildVariantEditPrompt(prompts, '换上红色嫁衣', false)).not.toContain('第二张参考图')
  })

  it('a user data directory can override any pipeline prompt without touching the bundled files', async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const d = await mkdtemp(join(tmpdir(), 'dramai-user-prompts-'))
    try {
      await mkdir(join(d, 'prompts'))
      await writeFile(
        join(d, 'prompts', 'x.prompt'),
        '---\nid: entities.merge.system\nlocale: zh\n---\n我的合并提示词',
        'utf8',
      )
      const c = loadCatalog({ extraDirs: [d] })
      expect(c.prompts.render('entities.merge.system', {})).toBe('我的合并提示词')
      expect(loadCatalog().prompts.render('entities.merge.system', {})).toContain('剧本资料员')
    } finally {
      await rm(d, { recursive: true, force: true })
    }
  })
})
