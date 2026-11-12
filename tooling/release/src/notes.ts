// 从 CHANGELOG.md（Keep a Changelog 格式）里取出某个版本的小节，用作 Release 说明。
import { readFileSync } from 'node:fs'

/** 取 `## [version]` 小节的正文（不含标题行）；找不到、或内容为空时返回 null。 */
export function extractChangelogSection(changelog: string, version: string): string | null {
  const lines = changelog.split(/\r?\n/)
  const heading = (line: string) => /^## \[/.test(line)
  const target = `## [${version}]`
  const start = lines.findIndex((line) => line === target || line.startsWith(`${target} `))
  if (start === -1) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (heading(lines[i] ?? '')) {
      end = i
      break
    }
  }
  const body = lines.slice(start + 1, end)
  // 最后一个小节后面跟着 `[x.y.z]: https://...` 链接定义，去掉
  while (body.length > 0 && /^(\[[^\]]+\]:\s|\s*$)/.test(body[body.length - 1] ?? '')) body.pop()
  while (body.length > 0 && (body[0] ?? '').trim() === '') body.shift()
  const text = body.join('\n').trim()
  return text === '' ? null : text
}

export function readChangelogSection(path: string, version: string): string | null {
  return extractChangelogSection(readFileSync(path, 'utf8'), version)
}
