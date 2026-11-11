import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseTemplate, renderNodes, TemplateError } from './template.ts'
import type { TemplateNode } from './template.ts'

/**
 * 提示词库：模板放在数据文件（`*.prompt`）里，运行时加载，带 schemaVersion，
 * 可按目录分层覆盖（内置 → 用户目录，后者按 (id, locale) 覆盖前者）。
 *
 * 文件格式：
 *   ---
 *   id: storyboard.system
 *   locale: zh
 *   schemaVersion: 1
 *   description: 一句话说明
 *   ---
 *   模板正文，可用 {{变量}} / {{#if}} / {{> 片段}}
 *
 * 片段放在 `partials/` 子目录，id 取文件名（去掉 `.prompt`）。
 */

export const PROMPT_SCHEMA_VERSION = 1

export interface PromptMeta {
  id: string
  locale: string
  schemaVersion: number
  description?: string
  /** 来源文件，便于排错。 */
  source: string
}

interface PromptEntry {
  meta: PromptMeta
  nodes: TemplateNode[]
}

export class PromptLibrary {
  private readonly entries = new Map<string, PromptEntry>()
  private readonly partials = new Map<string, TemplateNode[]>()

  /** 加载一个目录（可重复调用，后加载的覆盖先加载的）。 */
  loadDir(dir: string): this {
    for (const file of walk(dir)) {
      if (!file.endsWith('.prompt')) continue
      const text = readFileSync(file, 'utf8')
      const isPartial = file.split(/[\\/]/).includes('partials')
      this.addSource(text, file, isPartial)
    }
    return this
  }

  /** 直接添加一份模板源码（测试或内存数据）。 */
  addSource(text: string, source: string, isPartial = false): this {
    const { front, body } = splitFrontMatter(text, source)
    if (isPartial) {
      const name = front.id ?? (source.split(/[\\/]/).pop() ?? '').replace(/\.prompt$/, '')
      this.partials.set(name, parseTemplateWithPath(body, source))
      return this
    }
    if (!front.id) throw new TemplateError(`${source}: front matter is missing "id"`)
    const schemaVersion = Number(front.schemaVersion ?? PROMPT_SCHEMA_VERSION)
    if (schemaVersion !== PROMPT_SCHEMA_VERSION) {
      throw new TemplateError(
        `${source}: unsupported prompt schemaVersion ${schemaVersion} (expected ${PROMPT_SCHEMA_VERSION})`,
      )
    }
    const locale = front.locale ?? 'zh'
    const entry: PromptEntry = {
      meta: { id: front.id, locale, schemaVersion, description: front.description, source },
      nodes: parseTemplateWithPath(body, source),
    }
    this.entries.set(`${front.id}@${locale}`, entry)
    return this
  }

  has(id: string, locale = 'zh'): boolean {
    return this.find(id, locale) !== undefined
  }

  ids(): string[] {
    return [...new Set([...this.entries.values()].map((e) => e.meta.id))].sort()
  }

  meta(id: string, locale = 'zh'): PromptMeta | undefined {
    return this.find(id, locale)?.meta
  }

  render(id: string, vars: Record<string, unknown>, options: { locale?: string } = {}): string {
    const entry = this.find(id, options.locale ?? 'zh')
    if (!entry) throw new TemplateError(`unknown prompt: ${id}`)
    try {
      return renderNodes(entry.nodes, { vars, partial: (n) => this.partials.get(n) }).trim()
    } catch (err) {
      if (err instanceof TemplateError) {
        throw new TemplateError(`${entry.meta.source}: ${err.message}`)
      }
      throw err
    }
  }

  private find(id: string, locale: string): PromptEntry | undefined {
    return (
      this.entries.get(`${id}@${locale}`) ??
      this.entries.get(`${id}@zh`) ??
      [...this.entries.values()].find((e) => e.meta.id === id)
    )
  }
}

function parseTemplateWithPath(body: string, source: string): TemplateNode[] {
  try {
    return parseTemplate(body)
  } catch (err) {
    throw new TemplateError(`${source}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function splitFrontMatter(
  text: string,
  source: string,
): { front: Record<string, string>; body: string } {
  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return { front: {}, body: normalized }
  const end = normalized.indexOf('\n---\n', 4)
  if (end === -1) throw new TemplateError(`${source}: front matter is not closed`)
  const front: Record<string, string> = {}
  for (const line of normalized.slice(4, end).split('\n')) {
    const m = /^([A-Za-z][\w]*):\s*(.*)$/.exec(line)
    if (m) front[m[1]] = m[2].trim()
  }
  return { front, body: normalized.slice(end + 5) }
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}
