import { describe, expect, it } from 'vitest'
import { findEntities, findQuotes, splitSentences } from '../src/llm/zh.ts'
import { STORY } from './story.ts'

describe('Chinese text heuristics', () => {
  it('finds the people, places, props and costumes of a real short story', () => {
    const e = findEntities(STORY)
    expect(e.characters).toEqual(expect.arrayContaining(['沈青禾', '周望山', '阿福', '老掌柜']))
    // “周先生”是周望山的称呼，不是另一个人；“老茶馆”是地点，不是人
    expect(e.characters).not.toContain('周先生')
    expect(e.characters).not.toContain('老茶馆')
    expect(e.locations).toEqual(expect.arrayContaining(['老茶馆', '码头', '后院']))
    expect(e.props).toEqual(expect.arrayContaining(['铜钥匙', '旧信']))
    expect(e.props).not.toContain('信') // 被“旧信”包含的不单列
    expect(e.costumes).toEqual(expect.arrayContaining(['蓑衣', '旗袍']))
  })

  it('same input, same output', () => {
    expect(findEntities(STORY)).toEqual(findEntities(STORY))
  })

  it('attributes quotes to the speaker before or after them', () => {
    const names = ['阿福', '沈青禾']
    expect(findQuotes('阿福低声说：“客官，打烊了。”', names)).toEqual([
      { speaker: '阿福', text: '客官，打烊了。' },
    ])
    expect(findQuotes('“我不住店。”沈青禾说。', names)).toEqual([
      { speaker: '沈青禾', text: '我不住店。' },
    ])
  })

  it('splits sentences without cutting a quote in half', () => {
    expect(splitSentences('他说：“走吧。别回头。”然后转身离开了。')).toEqual([
      '他说：“走吧。别回头。”然后转身离开了。',
    ])
  })
})
