import { describe, expect, it } from 'vitest'
import type { ArtifactReport } from '@dramai/api'
import { formatBytes, hasFile, summarizeNarration } from '@/features/export/export-model'
import {
  conversionOf,
  draftOf,
  draftProblem,
  sameConversion,
} from '@/features/settings/conversion-model'

const report = (
  status: ArtifactReport['status'],
  kind: ArtifactReport['kind'] = 'shot_audio',
  file = false,
): ArtifactReport => ({
  key: `${kind}:${Math.random()}`,
  kind,
  status,
  changes: [],
  staleUpstream: [],
  ...(file ? { file: { path: 'a', mime: 'audio/wav', bytes: 1, sha256: 'x' } } : {}),
})

describe('export product list', () => {
  it('narration is the worst of its shots: missing beats stale beats current', () => {
    expect(summarizeNarration([report('current'), report('current')]).status).toBe('current')
    expect(summarizeNarration([report('current'), report('stale')]).status).toBe('stale')
    const s = summarizeNarration([
      report('current'),
      report('stale'),
      report('missing'),
      report('blocked'),
    ])
    expect(s).toMatchObject({ total: 4, current: 1, stale: 1, missing: 2, status: 'missing' })
    expect(summarizeNarration([report('current', 'cut')]).total).toBe(0)
  })
  it('a stale product can still be downloaded, a missing one cannot', () => {
    expect(hasFile(report('stale', 'cut', true))).toBe(true)
    expect(hasFile(report('missing', 'cut', true))).toBe(false)
    expect(hasFile(report('current', 'cut'))).toBe(false)
    expect(hasFile(undefined)).toBe(false)
  })
  it('formats sizes', () => {
    expect(formatBytes(512, 'en')).toBe('512 B')
    expect(formatBytes(2.7 * 1024, 'en')).toBe('2.7 KB')
    expect(formatBytes(20 * 1024 * 1024, 'en')).toBe('20 MB')
  })
})

describe('cost conversion draft', () => {
  it('is off by default and round-trips an existing conversion', () => {
    expect(conversionOf(draftOf(undefined))).toBeUndefined()
    const conv = { targetCurrency: 'CNY', rates: { USD: 7.2 } }
    expect(conversionOf(draftOf(conv))).toEqual(conv)
    expect(sameConversion(conv, { targetCurrency: 'CNY', rates: { USD: 7.2 } })).toBe(true)
  })
  it('names the first problem and where it is', () => {
    const d = (target: string, rows: { currency: string; rate: string }[]) => ({
      enabled: true,
      target,
      rows,
    })
    expect(draftProblem(d('', []))).toEqual({ kind: 'target' })
    expect(draftProblem(d('CNY', [{ currency: '1', rate: '2' }]))).toEqual({
      kind: 'currency',
      row: 0,
    })
    expect(draftProblem(d('CNY', [{ currency: 'USD', rate: '0' }]))).toEqual({
      kind: 'rate',
      row: 0,
    })
    expect(
      draftProblem(
        d('CNY', [
          { currency: 'USD', rate: '7' },
          { currency: 'usd', rate: '7' },
        ]),
      ),
    ).toEqual({ kind: 'duplicate', row: 1 })
    expect(draftProblem(d('CNY', [{ currency: 'CNY', rate: '1' }]))).toEqual({
      kind: 'duplicate',
      row: 0,
    })
    expect(draftProblem(d('CNY', [{ currency: 'usd', rate: '7.2' }]))).toBeUndefined()
    expect(conversionOf(d('cny', [{ currency: 'usd', rate: '7.2' }]))).toEqual({
      targetCurrency: 'CNY',
      rates: { USD: 7.2 },
    })
  })
})
