import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.resolve(__dirname, '../src/v2/styles/theme.css'), 'utf8')

/** 取出 selector 对应花括号里的全部 `--name: value` 声明。 */
function declarations(selectorStart: string): Record<string, string> {
  const start = css.indexOf(selectorStart)
  expect(start, `找不到 ${selectorStart}`).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  const body = css.slice(open + 1, close)
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g))
    out[m[1]] = m[2].replace(/\s*\/\*.*?\*\/\s*/g, '').trim()
  return out
}

describe('theme.css', () => {
  const dark = declarations(":root,\n[data-theme='dark']")
  const light = declarations("[data-theme='light'] {")
  const system = declarations(':root:not([data-theme])')

  it('深色与浅色定义同一组 token', () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort())
    expect(Object.keys(dark).length).toBeGreaterThanOrEqual(24)
  })

  it('没有 data-theme 时的系统浅色与显式浅色完全一致', () => {
    expect(system).toEqual(light)
  })

  it('朱砂在两个主题里是同一个值，墨与纸是各自的底色', () => {
    expect(dark['--accent']).toBe(light['--accent'])
    expect(dark['--accent-foreground']).toBe(light['--accent-foreground'])
    expect(dark['--accent-hover']).toBe(light['--accent-hover'])
    expect(dark['--accent-foreground']).toBe(dark['--background'])
    expect(dark['--background']).not.toBe(light['--background'])
  })

  it('@theme inline 里每个颜色都指向存在的变量', () => {
    const block = css.slice(css.indexOf('@theme inline'), css.indexOf('@theme {'))
    const refs = [...block.matchAll(/--color-[\w-]+:\s*var\((--[\w-]+)\)/g)].map((m) => m[1])
    expect(refs.length).toBeGreaterThanOrEqual(23)
    for (const ref of refs) expect(dark, ref).toHaveProperty(ref)
  })

  it('没有衬线字体和外部域名', () => {
    expect(css).not.toMatch(/serif(?!\s*;)/)
    const fonts = readFileSync(path.resolve(__dirname, '../src/v2/styles/fonts.css'), 'utf8')
    expect(`${css}${fonts}`).not.toMatch(/https?:\/\//)
  })
})
