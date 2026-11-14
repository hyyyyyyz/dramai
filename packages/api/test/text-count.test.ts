import { describe, expect, it } from 'vitest'
import { countText } from '../src/index.ts'

// The same table as packages/core/test/text-count.test.ts; packages/server/test/text-count-same.test.ts compares the
// two implementations on a much larger sample as well.
const CASES: Array<[string, string, number, number]> = [
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

describe('countText (the one the front end imports)', () => {
  it.each(CASES)('%s', (_name, text, doubled, plain) => {
    expect(countText('cjk_double', text)).toBe(doubled)
    expect(countText('characters', text)).toBe(plain)
  })
})
