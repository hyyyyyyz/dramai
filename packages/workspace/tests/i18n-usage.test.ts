import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import zh from '@/i18n/locales/zh-CN'

/**
 * 源码里每个 t('键') 都必须在 zh-CN 里存在（i18next 找不到键时会悄悄显示键名本身）。
 * 动态键 t(`jobs.op.${x}`) 只检查前缀下至少有一个键。
 */
type Dict = { [k: string]: string | Dict }
function flatten(d: Dict, prefix = ''): string[] {
  return Object.entries(d).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k
    return typeof v === 'string' ? [key] : flatten(v, key)
  })
}
const keys = new Set(flatten(zh as Dict))

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory()
      ? f === 'locales'
        ? []
        : files(p)
      : /\.tsx?$/.test(f)
        ? [p]
        : []
  })
}

describe('translation keys used in source exist', () => {
  const src = files(join(import.meta.dirname, '../src'))
  const literal = /\bt\(\s*'([A-Za-z0-9_.:-]+)'/g
  const templ = /\bt\(\s*`([A-Za-z0-9_.:-]*)\$\{/g
  const used: { file: string; key: string; dynamic: boolean }[] = []
  for (const file of src) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(literal)) used.push({ file, key: m[1]!, dynamic: false })
    for (const m of text.matchAll(templ)) used.push({ file, key: m[1]!, dynamic: true })
  }

  it('finds a reasonable number of usages (guards the regexes)', () => {
    expect(used.length).toBeGreaterThan(100)
  })

  it('every literal key exists', () => {
    const missing = used
      .filter((u) => !u.dynamic && !keys.has(u.key))
      .map((u) => `${u.key}  (${u.file.split('/src/')[1]})`)
    expect(missing).toEqual([])
  })

  it('every dynamic prefix has keys below it', () => {
    const missing = used
      .filter((u) => u.dynamic && ![...keys].some((k) => k.startsWith(u.key)))
      .map((u) => `${u.key}\${…}  (${u.file.split('/src/')[1]})`)
    expect(missing).toEqual([])
  })
})
