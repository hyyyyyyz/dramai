import { describe, expect, it } from 'vitest'
import {
  candidateProgress,
  CONFIDENCE_THRESHOLDS,
  confidenceBand,
  createAsset,
  decideCandidate,
  suggestMatch,
  validateAsset,
} from '../src/domain/index.ts'
import type { Asset, EntityCandidate } from '../src/domain/index.ts'

const candidate = (over: Partial<EntityCandidate> = {}): EntityCandidate => ({
  schemaVersion: 1,
  id: 'cand_1',
  projectId: 'p',
  kind: 'character',
  name: '总管',
  aliases: [],
  shotIds: ['s1'],
  variants: [],
  status: 'pending',
  extractedAt: 1,
  createdAt: 1,
  ...over,
})
const asset = (
  id: string,
  name: string,
  kind: Asset['kind'] = 'character',
  aliases: string[] = [],
): Asset => ({
  ...createAsset({ id, projectId: 'p', number: 1, kind, name, now: 1 }),
  aliases,
})

describe('candidate confidence: a number, with high / medium / low bands from one place', () => {
  it('uses the central thresholds', () => {
    expect(CONFIDENCE_THRESHOLDS).toEqual({ high: 0.8, medium: 0.5 })
    expect(confidenceBand(0.95)).toBe('high')
    expect(confidenceBand(0.8)).toBe('high')
    expect(confidenceBand(0.79)).toBe('medium')
    expect(confidenceBand(0.5)).toBe('medium')
    expect(confidenceBand(0.49)).toBe('low')
    expect(confidenceBand(0)).toBe('low')
  })
  it('clamps out-of-range numbers; missing or NaN counts as low (unknown gets a human look)', () => {
    expect(confidenceBand(1.7)).toBe('high')
    expect(confidenceBand(-3)).toBe('low')
    expect(confidenceBand(undefined)).toBe('low')
    expect(confidenceBand(Number.NaN)).toBe('low')
  })
  it('accepts custom thresholds without touching the defaults', () => {
    expect(confidenceBand(0.7, { high: 0.9, medium: 0.6 })).toBe('medium')
    expect(confidenceBand(0.7)).toBe('medium')
    expect(confidenceBand(0.85, { high: 0.9, medium: 0.6 })).toBe('medium')
  })
})

describe('candidate outcomes: new asset / linked to existing / ignored', () => {
  it('accept_new records the created asset', () => {
    const c = decideCandidate(candidate(), { action: 'accept_new', createdAssetId: 'asset_9' }, 50)
    expect(c).toMatchObject({ status: 'accepted_new', createdAssetId: 'asset_9', handledAt: 50 })
    expect(c.linkedAssetId).toBeUndefined()
  })
  it('link records the existing asset', () => {
    const c = decideCandidate(candidate(), { action: 'link', assetId: 'asset_3' }, 60)
    expect(c).toMatchObject({ status: 'linked', linkedAssetId: 'asset_3', handledAt: 60 })
    expect(c.createdAssetId).toBeUndefined()
  })
  it('ignore just closes it', () => {
    expect(decideCandidate(candidate(), { action: 'ignore' }, 70)).toMatchObject({
      status: 'ignored',
      handledAt: 70,
    })
  })
  it('does not mutate the input and refuses to handle a candidate twice', () => {
    const original = candidate()
    const handled = decideCandidate(original, { action: 'ignore' }, 1)
    expect(original.status).toBe('pending')
    expect(() => decideCandidate(handled, { action: 'link', assetId: 'x' }, 2)).toThrow(
      /already handled/,
    )
  })
  it('summarises progress by outcome', () => {
    const list = [
      candidate({ status: 'pending' }),
      candidate({ status: 'accepted_new' }),
      candidate({ status: 'linked' }),
      candidate({ status: 'linked' }),
      candidate({ status: 'ignored' }),
    ]
    expect(candidateProgress(list)).toEqual({
      total: 5,
      pending: 1,
      accepted_new: 1,
      linked: 2,
      ignored: 1,
      handled: 4,
    })
    expect(candidateProgress([])).toEqual({
      total: 0,
      pending: 0,
      accepted_new: 0,
      linked: 0,
      ignored: 0,
      handled: 0,
    })
  })
})

describe('suggested match: "may be the same as existing X", with the basis', () => {
  it('matches an identical name (after normalisation)', () => {
    const m = suggestMatch(candidate({ name: ' 总管 太监 ' }), [
      asset('a1', '总管太监'),
      asset('a2', '林夏'),
    ])
    expect(m).toMatchObject({ assetId: 'a1', score: 1 })
    expect(m?.basis).toEqual([
      { type: 'exact_name', candidateText: ' 总管 太监 ', assetText: '总管太监' },
    ])
  })

  it('matches through aliases in either direction', () => {
    const m = suggestMatch(candidate({ name: '林姑娘', aliases: ['林夏'] }), [
      asset('a1', '林夏', 'character', ['夏儿']),
    ])
    expect(m).toMatchObject({ assetId: 'a1', score: 0.9 })
    expect(m?.basis[0]).toMatchObject({ type: 'alias', candidateText: '林夏', assetText: '林夏' })
    const m2 = suggestMatch(candidate({ name: '夏儿' }), [
      asset('a1', '林夏', 'character', ['夏儿']),
    ])
    expect(m2?.basis[0]).toMatchObject({ type: 'alias' })
  })

  it('falls back to "one name contains the other" (two characters or more), with a lower score', () => {
    const m = suggestMatch(candidate({ name: '总管' }), [asset('a1', '总管太监')])
    expect(m?.basis[0].type).toBe('name_contains')
    expect(m!.score).toBeGreaterThan(0.2)
    expect(m!.score).toBeLessThan(0.9)
    expect(suggestMatch(candidate({ name: '总' }), [asset('a1', '总管太监')])).toBeUndefined()
  })

  it('only suggests assets of the same kind that are not deleted, and picks the best one', () => {
    expect(
      suggestMatch(candidate({ name: '老茶馆' }), [asset('a1', '老茶馆', 'location')]),
    ).toBeUndefined()
    expect(
      suggestMatch(candidate({ name: '总管' }), [{ ...asset('a1', '总管'), deletedAt: 5 }]),
    ).toBeUndefined()
    const best = suggestMatch(candidate({ name: '总管' }), [
      asset('a1', '总管太监'),
      asset('a2', '总管'),
    ])
    expect(best?.assetId).toBe('a2')
  })

  it('returns nothing for strangers', () => {
    expect(suggestMatch(candidate({ name: '陌生人' }), [asset('a1', '林夏')])).toBeUndefined()
    expect(suggestMatch(candidate({ name: '陌生人' }), [])).toBeUndefined()
  })

  it('a suggestion can come from the extractor (LLM) as well as from the rules', () => {
    const c = candidate({
      suggestedMatch: {
        assetId: 'a1',
        score: 0.7,
        basis: [{ type: 'llm', note: '同一人，称呼不同' }],
      },
    })
    expect(c.suggestedMatch?.basis[0].type).toBe('llm')
  })
})

describe('costume vs variant boundary', () => {
  const lookup = (assets: Asset[]) => (id: string) => assets.find((a) => a.id === id)
  const hero = (variants: Asset['variants']): Asset => ({ ...asset('h', '林夏'), variants })
  const variant = (over: Partial<Asset['variants'][number]> = {}): Asset['variants'][number] => ({
    name: '新娘',
    description: 'd',
    origin: 'edit',
    sheet: { currentVersionId: null, versions: [] },
    ...over,
  })
  const costume = asset('c', '红嫁衣', 'costume')

  it('a variant may link one costume asset, or none', () => {
    expect(
      validateAsset(
        hero([variant({ costumeAssetId: 'c' }), variant({ name: '素颜' })]),
        lookup([costume]),
      ),
    ).toEqual([])
  })

  it('the linked asset must exist and must be a costume', () => {
    const issues = validateAsset(
      hero([variant({ costumeAssetId: 'ghost' }), variant({ name: 'x', costumeAssetId: 'p' })]),
      lookup([asset('p', '青瓷杯', 'prop')]),
    )
    expect(issues.map((i) => i.code)).toEqual(['COSTUME_NOT_FOUND', 'COSTUME_NOT_COSTUME_KIND'])
  })

  it('variants belong to characters: neither costumes nor props/locations carry them', () => {
    expect(
      validateAsset({ ...asset('c', '红嫁衣', 'costume'), variants: [variant()] }, lookup([])).map(
        (i) => i.code,
      ),
    ).toEqual(['COSTUME_WITH_VARIANTS'])
    expect(
      validateAsset({ ...asset('p', '杯', 'prop'), variants: [variant()] }, lookup([])).map(
        (i) => i.code,
      ),
    ).toEqual(['VARIANTS_ON_NON_CHARACTER'])
  })

  it('variant names are unique and slash-free', () => {
    const issues = validateAsset(hero([variant(), variant(), variant({ name: 'a/b' })]), lookup([]))
    expect(issues.map((i) => i.code)).toEqual(['VARIANT_NAME_DUPLICATE', 'VARIANT_NAME_INVALID'])
  })
})
