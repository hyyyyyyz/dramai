import { describe, expect, it } from 'vitest'
import { snapDuration } from '../src/providers/duration.ts'
import {
  buildSrt,
  buildVtt,
  cuesFromShots,
  effectiveDurationSec,
  formatSrtTime,
  formatVttTime,
} from '../src/subtitles/index.ts'

describe('time formatting', () => {
  it('formats SRT and VTT time codes', () => {
    expect(formatSrtTime(0)).toBe('00:00:00,000')
    expect(formatSrtTime(61_250)).toBe('00:01:01,250')
    expect(formatVttTime(3_723_004)).toBe('01:02:03.004')
  })

  it('never produces 1000 ms (v0.4 rounding overflow)', () => {
    expect(formatSrtTime(1999.6)).toBe('00:00:02,000')
    expect(formatSrtTime(999.5)).toBe('00:00:01,000')
  })
})

describe('cuesFromShots', () => {
  it('lays narrated shots on a running clock; silent shots only take time', () => {
    const cues = cuesFromShots([
      { narration: '第一句', durationSec: 5 },
      { durationSec: 3 },
      { narration: '  第三句  ', durationSec: 4 },
    ])
    expect(cues).toEqual([
      { startMs: 0, endMs: 5000, text: '第一句' },
      { startMs: 8000, endMs: 12000, text: '第三句' },
    ])
  })

  it('falls back to 5 s for missing or invalid durations', () => {
    expect(effectiveDurationSec(undefined)).toBe(5)
    expect(effectiveDurationSec(0)).toBe(5)
    expect(effectiveDurationSec(-2)).toBe(5)
    expect(effectiveDurationSec(Number.NaN)).toBe(5)
    expect(cuesFromShots([{ narration: 'a' }])[0].endMs).toBe(5000)
  })

  it('handles fractional durations without drift', () => {
    const cues = cuesFromShots([
      { narration: 'a', durationSec: 2.5 },
      { narration: 'b', durationSec: 1.25 },
    ])
    expect(cues.map((c) => [c.startMs, c.endMs])).toEqual([
      [0, 2500],
      [2500, 3750],
    ])
  })
})

describe('buildSrt / buildVtt', () => {
  const cues = [
    { startMs: 0, endMs: 1500, text: 'hello' },
    { startMs: 2000, endMs: 3000, text: '你好' },
  ]
  it('builds SRT', () => {
    expect(buildSrt(cues)).toBe(
      '1\n00:00:00,000 --> 00:00:01,500\nhello\n\n2\n00:00:02,000 --> 00:00:03,000\n你好\n',
    )
  })
  it('builds VTT', () => {
    expect(buildVtt(cues)).toBe(
      'WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nhello\n\n00:00:02.000 --> 00:00:03.000\n你好\n',
    )
  })
  it('is empty-safe', () => {
    expect(buildSrt([])).toBe('')
    expect(buildVtt([])).toBe('WEBVTT\n')
  })
})

describe('snapDuration (duration normalisation)', () => {
  it('snaps to the nearest allowed value, ties go shorter', () => {
    expect(snapDuration(6, [3, 4, 5, 10, 15])).toBe(5)
    expect(snapDuration(7, [3, 4, 5, 10, 15])).toBe(5) // 5 与 10 距离 2/3
    expect(snapDuration(7.5, [5, 10])).toBe(5) // 平局取短
    expect(snapDuration(12, [3, 4, 5, 10, 15])).toBe(10)
    expect(snapDuration(100, [3, 4, 5, 10, 15])).toBe(15)
  })
  it('clamps to a continuous range', () => {
    expect(snapDuration(2, { min: 4, max: 15 })).toBe(4)
    expect(snapDuration(9.6, { min: 4, max: 15 })).toBe(10)
    expect(snapDuration(30, { min: 4, max: 15 })).toBe(15)
  })
  it('uses 5 for invalid requests and rounds when there is no rule', () => {
    expect(snapDuration(Number.NaN, [5, 10])).toBe(5)
    expect(snapDuration(0, undefined)).toBe(5)
    expect(snapDuration(4.6, undefined)).toBe(5)
  })
  it('supports fixed single-value models', () => {
    expect(snapDuration(8, { values: [5] })).toBe(5)
  })
})
