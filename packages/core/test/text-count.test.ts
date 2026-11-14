import { describe, expect, it } from 'vitest'
import { countText } from '../src/providers/text-count.ts'
import { dashscopeCosyvoice } from '../src/providers/protocols/index.ts'

/**
 * How lengths are counted. The Alibaba rule (non-realtime TTS guide, 2026-11-13): Chinese characters (simplified,
 * traditional, Japanese kanji, Korean hanja) count 2; punctuation, letters, digits, kana and hangul count 1. The page
 * does not say anything about full-width punctuation / letters, half-width katakana or emoji: counted 1 (never a false block).
 */
export const COUNT_CASES: Array<[string, string, number, number]> = [
  // [name, text, cjk_double, characters]
  ['simplified Han', '汉字', 4, 2],
  ['traditional Han', '漢字', 4, 2],
  ['Han in the supplementary plane (U+20000)', '\u{20000}', 2, 1],
  ['Han extension B + ASCII', 'a\u{2A6D6}b', 4, 3],
  ['Japanese kanji', '日本語', 6, 3],
  ['hiragana', 'ひらがな', 4, 4],
  ['katakana', 'カタカナ', 4, 4],
  ['half-width katakana', 'ｱｲｳ', 3, 3],
  ['hangul', '한글입니다', 5, 5],
  ['Korean hanja', '韓國', 4, 2],
  ['kana + kanji mix', '日本語のテキスト', 11, 8],
  ['ASCII letters and digits', 'abc123', 6, 6],
  ['half-width punctuation', ',.!?', 4, 4],
  ['full-width punctuation (page is silent: 1 each)', '，。！？、', 5, 5],
  ['CJK brackets (page is silent: 1 each)', '「」『』', 4, 4],
  ['full-width letters and digits (page is silent: 1 each)', 'ＡＢＣ１２３', 6, 6],
  ['emoji', '😀', 1, 1],
  ['emoji ZWJ sequence = 5 code points', '👨‍👩‍👧', 5, 5],
  ['combining character = 2 code points', 'é', 2, 2],
  ['spaces and newlines', ' \n\t', 3, 3],
  ['empty', '', 0, 0],
  ['the reviewer sample', 'Hello 世界！😀 ok', 15, 13],
]

describe('countText', () => {
  it.each(COUNT_CASES)('%s', (_name, text, doubled, plain) => {
    expect(countText('cjk_double', text)).toBe(doubled)
    expect(countText('characters', text)).toBe(plain)
  })

  it('51 kana are 51 and pass the 100 limit; 51 Han characters are 102 and do not', () => {
    const inputs = (instructions: string) =>
      dashscopeCosyvoice.inputProblem!(
        { baseUrl: 'https://w.cn-beijing.maas.aliyuncs.com', model: 'm' },
        { text: 'x', instructions },
      )
    expect(inputs('あ'.repeat(51))).toBeUndefined()
    expect(inputs('あ'.repeat(100))).toBeUndefined()
    expect(inputs('あ'.repeat(101))).toMatchObject({
      details: { limit: 100, actual: 101, counting: 'cjk_double' },
    })
    expect(inputs('字'.repeat(50))).toBeUndefined()
    expect(inputs('字'.repeat(51))).toMatchObject({ details: { actual: 102 } })
    expect(inputs('\u{20000}'.repeat(51))).toMatchObject({ details: { actual: 102 } })
    expect(inputs('，'.repeat(100))).toBeUndefined() // full-width punctuation: never a false block
  })
})
