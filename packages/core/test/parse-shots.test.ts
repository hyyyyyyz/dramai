import { describe, expect, it } from 'vitest'
import { parseShots } from '../src/prompts/parse-shots.ts'

const shot = (n: number, extra: Record<string, unknown> = {}) => ({
  sequence: n,
  scene_text: `scene ${n}`,
  ...extra,
})

describe('parseShots', () => {
  it('parses a clean object', () => {
    const out = parseShots(
      JSON.stringify({ shots: [shot(1, { narration: 'n', duration_sec: 4 })] }),
    )
    expect(out).toEqual([
      {
        sequence: 1,
        scene_text: 'scene 1',
        narration: 'n',
        image_prompt: undefined,
        character_names: undefined,
        duration_sec: 4,
      },
    ])
  })

  it('strips code fences', () => {
    const out = parseShots('```json\n' + JSON.stringify({ shots: [shot(1), shot(2)] }) + '\n```')
    expect(out.map((s) => s.sequence)).toEqual([1, 2])
  })

  it('ignores prose before and after the JSON', () => {
    const out = parseShots(
      '好的，分镜如下：\n' + JSON.stringify({ shots: [shot(1)] }) + '\n希望有帮助！',
    )
    expect(out).toHaveLength(1)
  })

  it('is not fooled by braces inside strings', () => {
    const text = '前言 {"shots":[{"scene_text":"他说 } 然后 { 走了","sequence":1}]} 结尾'
    expect(parseShots(text)[0].scene_text).toBe('他说 } 然后 { 走了')
  })

  it('accepts a bare top-level array', () => {
    expect(parseShots(JSON.stringify([shot(1), shot(2)]))).toHaveLength(2)
  })

  it('accepts camelCase keys', () => {
    const out = parseShots(
      JSON.stringify({
        shots: [{ sceneText: 'x', imagePrompt: 'p', durationSec: 3, characterNames: ['a'] }],
      }),
    )
    expect(out[0]).toMatchObject({
      scene_text: 'x',
      image_prompt: 'p',
      duration_sec: 3,
      character_names: ['a'],
    })
  })

  it('fills in a missing sequence from position and drops shots without scene_text', () => {
    const out = parseShots(
      JSON.stringify({
        shots: [{ scene_text: 'a' }, { narration: 'no scene' }, { scene_text: 'c' }],
      }),
    )
    expect(out.map((s) => [s.sequence, s.scene_text])).toEqual([
      [1, 'a'],
      [3, 'c'],
    ])
  })

  it('drops non-string character names', () => {
    const out = parseShots(
      JSON.stringify({ shots: [shot(1, { character_names: ['a', 2, null, 'b'] })] }),
    )
    expect(out[0].character_names).toEqual(['a', 'b'])
  })

  it('salvages complete shots from truncated output', () => {
    const full = JSON.stringify({ shots: [shot(1), shot(2), shot(3)] })
    const cut = full.slice(0, full.length - 14) // 截断在第三个镜头里
    const out = parseShots(cut)
    expect(out.map((s) => s.sequence)).toEqual([1, 2])
  })

  it('returns [] for garbage and empty input', () => {
    expect(parseShots('')).toEqual([])
    expect(parseShots('对不起，我做不到')).toEqual([])
    expect(parseShots('{"shots": "nope"}')).toEqual([])
  })
})
