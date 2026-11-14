import { describe, expect, it } from 'vitest'
import { COUNTING_MODES, countText as apiCount } from '@dramai/api'
import { countText as coreCount } from '@dramai/core'

/**
 * Two implementations of the counting rule exist on purpose: core is built and packaged on its own and does not
 * depend on the contract package (adding that edge for one pure function changes the build order and the packaging).
 * This compares them on a large sample that contains every category of the rule, so one cannot drift from the other.
 */
const PIECES = [
  '汉',
  '漢',
  '\u{20000}',
  '\u{2A6D6}',
  '\u{2EBF0}',
  '日',
  '韓',
  '々',
  '〇',
  'あ',
  'ア',
  'ｱ',
  '한',
  'ㄱ',
  'a',
  'Z',
  '0',
  '9',
  ' ',
  '\n',
  '\t',
  ',',
  '.',
  '!',
  '，',
  '。',
  '！',
  '、',
  '「',
  '」',
  '（',
  '）',
  '：',
  'Ａ',
  'Ｚ',
  '１',
  '９',
  '😀',
  '👨‍👩‍👧',
  '🇨🇳',
  'é',
  'é',
  '́',
  '‍',
  '～',
  '—',
  '…',
]

describe('both counting implementations agree', () => {
  it('on every piece, every pair and 20000 seeded random strings', () => {
    let n = 0
    const same = (s: string) => {
      for (const mode of COUNTING_MODES) {
        if (apiCount(mode, s) !== coreCount(mode, s))
          throw new Error(`${mode} differs on ${JSON.stringify(s)}`)
      }
      n++
    }
    for (const a of PIECES) {
      same(a)
      for (const b of PIECES) same(a + b)
    }
    let seed = 12345
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (let i = 0; i < 20000; i++) {
      const len = 1 + Math.floor(rnd() * 40)
      let s = ''
      for (let j = 0; j < len; j++) s += PIECES[Math.floor(rnd() * PIECES.length)]
      same(s)
    }
    expect(n).toBeGreaterThan(22000)
  })

  it('the same modes are known on both sides', () => {
    expect([...COUNTING_MODES]).toEqual(['characters', 'cjk_double'])
  })
})
