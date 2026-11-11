import { describe, expect, it } from 'vitest'
import {
  aspectParts,
  allocateNumber,
  appendVersion,
  assetHasSheet,
  createAsset,
  createProject,
  createShot,
  currentVersion,
  effectiveAspect,
  emptySlot,
  isAspectRatio,
  orderedShotIds,
  setCurrentVersion,
  validateAssetName,
  versionFilePath,
} from '../src/domain/index.ts'
import {
  extractMentions,
  renderMentionsForLlm,
  resolveMentionsFromLlm,
} from '../src/prompts/mentions.ts'
import { fileRef } from './helpers.ts'

describe('versions (A7): regenerating never destroys the previous result', () => {
  const v = (id: string, source: 'generated' | 'uploaded' | 'image_edit' = 'generated') => ({
    id,
    kind: 'image' as const,
    file: fileRef(`images/x/${id}.png`),
    source,
    createdAt: 1,
  })

  it('appends and moves the current pointer, keeping history', () => {
    let slot = emptySlot()
    expect(currentVersion(slot)).toBeUndefined()
    slot = appendVersion(slot, v('v1'))
    slot = appendVersion(slot, v('v2'))
    expect(slot.versions.map((x) => x.id)).toEqual(['v1', 'v2'])
    expect(currentVersion(slot)?.id).toBe('v2')
  })

  it('can append without becoming current, and roll back', () => {
    let slot = appendVersion(emptySlot(), v('v1'))
    slot = appendVersion(slot, v('v2'), { makeCurrent: false })
    expect(slot.currentVersionId).toBe('v1')
    slot = setCurrentVersion(slot, 'v2')
    slot = setCurrentVersion(slot, 'v1')
    expect(slot.currentVersionId).toBe('v1')
    expect(slot.versions).toHaveLength(2)
  })

  it('is immutable and rejects duplicate / unknown versions', () => {
    const a = appendVersion(emptySlot(), v('v1'))
    const b = appendVersion(a, v('v2'))
    expect(a.versions).toHaveLength(1)
    expect(b).not.toBe(a)
    expect(() => appendVersion(b, v('v1'))).toThrow(/already exists/)
    expect(() => setCurrentVersion(b, 'nope')).toThrow(/unknown version/)
  })

  it('puts the version id into the file path so old files are never overwritten', () => {
    const p1 = versionFilePath({ dir: 'images', ownerKey: 'shot_1', versionId: 'v1', ext: '.png' })
    const p2 = versionFilePath({ dir: 'images', ownerKey: 'shot_1', versionId: 'v2', ext: 'png' })
    expect(p1).toBe('images/shot_1/v1.png')
    expect(p1).not.toBe(p2)
  })
})

describe('project / ordering', () => {
  it('validates aspect ratios', () => {
    expect(isAspectRatio('9:16')).toBe(true)
    expect(isAspectRatio('4:3')).toBe(false)
    expect(aspectParts('16:9')).toEqual({ w: 16, h: 9 })
  })

  it('aspect ratio on the project is the source of truth; shot override is optional', () => {
    const p = createProject({ id: 'p', name: 'n', aspectRatio: '9:16', now: 1 })
    const s = createShot({ id: 's', projectId: 'p', sceneId: 'sc', number: 1, now: 1 })
    expect(effectiveAspect(p, s)).toBe('9:16')
    expect(effectiveAspect(p, { aspectOverride: '1:1' })).toBe('1:1')
  })

  it('counters are monotonic and never reuse a number, even after deletion', () => {
    let p = createProject({ id: 'p', name: 'n', aspectRatio: '9:16', now: 1 })
    const seen: number[] = []
    for (let i = 0; i < 3; i++) {
      const r = allocateNumber(p, 'shot')
      p = r.project
      seen.push(r.number)
    }
    // "删除"镜头 3 不会让计数回退
    const next = allocateNumber(p, 'shot')
    expect([...seen, next.number]).toEqual([1, 2, 3, 4])
    expect(allocateNumber(p, 'episode').number).toBe(1)
  })

  it('final-cut order comes from the ordered lists, not from ids or numbers', () => {
    const project = { episodeOrder: ['e2', 'e1'] }
    const episodes = new Map([
      ['e1', { sceneOrder: ['s1'] }],
      ['e2', { sceneOrder: ['s2', 's3'] }],
    ])
    const scenes = new Map([
      ['s1', { shotOrder: ['a', 'b'] }],
      ['s2', { shotOrder: ['z'] }],
      ['s3', { shotOrder: ['m', 'x'] }],
    ])
    expect(orderedShotIds(project, episodes, scenes)).toEqual(['z', 'm', 'x', 'a', 'b'])
    // 引用了已删除的集/场时跳过
    expect(
      orderedShotIds(
        { episodeOrder: ['e1', 'gone'] },
        episodes,
        new Map([['s1', { shotOrder: ['a'] }]]),
      ),
    ).toEqual(['a'])
  })

  it('assets: names must be non-empty and free of "/"; originals do not count as a sheet', () => {
    expect(validateAssetName('林夏')).toBeNull()
    expect(validateAssetName(' ')).not.toBeNull()
    expect(validateAssetName('林夏/婚纱')).not.toBeNull()
    const a = createAsset({
      id: 'a',
      projectId: 'p',
      number: 1,
      kind: 'character',
      name: 'x',
      now: 1,
    })
    const withOriginal = { ...a, originals: [fileRef('materials/o.png')] }
    expect(assetHasSheet(withOriginal)).toBe(false)
  })
})

describe('mentions: stable ids inside the store, names only at the LLM boundary', () => {
  const assets = [
    { id: 'a1', name: '林夏' },
    { id: 'a2', name: '林夏之母', aliases: ['林母'] },
    { id: 'a3', name: '老茶馆' },
  ]

  it('extracts mentions in first-appearance order, de-duplicated', () => {
    expect(extractMentions('@{a3} 里 @{a1} 与 @{a1/婚纱} 和 @{a3}')).toEqual([
      { assetId: 'a3', variantName: undefined },
      { assetId: 'a1', variantName: undefined },
      { assetId: 'a1', variantName: '婚纱' },
    ])
  })

  it('renders names for the LLM; a rename only changes the asset row', () => {
    const stored = '@{a1} 走进 @{a3}，换上 @{a1/婚纱}'
    expect(renderMentionsForLlm(stored, assets)).toBe('@林夏 走进 @老茶馆，换上 @林夏/婚纱')
    const renamed = assets.map((a) => (a.id === 'a1' ? { ...a, name: '林夏夏' } : a))
    expect(renderMentionsForLlm(stored, renamed)).toBe('@林夏夏 走进 @老茶馆，换上 @林夏夏/婚纱')
  })

  it('leaves unknown ids alone (admission blocks them)', () => {
    expect(renderMentionsForLlm('@{ghost}', assets)).toBe('@{ghost}')
  })

  it('resolves LLM text back to ids, longest name first, with variants', () => {
    expect(resolveMentionsFromLlm('@林夏之母 看着 @林夏，@林夏/婚纱 很美。@老茶馆', assets)).toBe(
      '@{a2} 看着 @{a1}，@{a1/婚纱} 很美。@{a3}',
    )
    expect(resolveMentionsFromLlm('@林母 来了', assets)).toBe('@{a2} 来了')
    expect(resolveMentionsFromLlm('邮件 a@b.com 与 @陌生人', assets)).toBe(
      '邮件 a@b.com 与 @陌生人',
    )
  })
})
