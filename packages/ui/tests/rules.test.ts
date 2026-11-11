import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// 对 src/v2 的源码做两条静态检查，防止以后又写进规范不允许的东西。
const root = path.resolve(__dirname, '../src/v2')

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return sources(full)
    return /\.(tsx?|css)$/.test(e.name) && !e.name.includes('noto-sans-sc') ? [full] : []
  })
}

function stripComments(code: string) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('v2 源码规则', () => {
  const files = sources(root).filter((f) => /\.tsx?$/.test(f))

  it('组件里没有写死的中文：可见文字和无障碍名称都必须由调用方传入', () => {
    const offenders = files.flatMap((f) => {
      const code = stripComments(readFileSync(f, 'utf8'))
      return /[\u4e00-\u9fff]/.test(code) ? [path.relative(root, f)] : []
    })
    expect(offenders).toEqual([])
  })

  it('循环动画只有 busy-slide（不确定进度条）：没有 spin / pulse / bounce / ping', () => {
    const offenders = files.flatMap((f) => {
      const code = stripComments(readFileSync(f, 'utf8'))
      return /animate-(spin|pulse|bounce|ping)|\binfinite\b/.test(code)
        ? [path.relative(root, f)]
        : []
    })
    expect(offenders).toEqual([])
    const theme = readFileSync(path.join(root, 'styles/theme.css'), 'utf8')
    const infinite = [...theme.matchAll(/--animate-([\w-]+):[^;]*infinite/g)].map((m) => m[1])
    expect(infinite).toEqual(['busy-slide'])
  })
})
