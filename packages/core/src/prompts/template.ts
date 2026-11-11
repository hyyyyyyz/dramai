/**
 * 极小的提示词模板引擎。故意只支持提示词需要的最少语法：
 *
 *   {{name}} / {{a.b}}        变量（缺失 → 报错并列出变量名，不静默输出空串）
 *   {{#if name}}…{{else}}…{{/if}}   条件（非空字符串/非空数组/true/非零数字为真），可嵌套
 *   {{> partial}}             引入具名片段（用同一份变量渲染）
 *   {{! 注释 }}               注释
 *
 * 不是通用模板引擎：没有循环、过滤器、表达式。列表在代码里先渲染成字符串再传入。
 */

export class TemplateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TemplateError'
  }
}

type Node =
  | { type: 'text'; value: string }
  | { type: 'var'; path: string }
  | { type: 'partial'; name: string }
  | { type: 'if'; path: string; then: Node[]; otherwise: Node[] }

const TAG = /\{\{\s*([#/>!]?)\s*([^}]*?)\s*\}\}/g

export function parseTemplate(source: string): Node[] {
  const root: Node[] = []
  const stack: Array<{ node: Extract<Node, { type: 'if' }>; inElse: boolean }> = []
  const current = (): Node[] => {
    const top = stack[stack.length - 1]
    if (!top) return root
    return top.inElse ? top.node.otherwise : top.node.then
  }
  let last = 0
  for (const m of source.matchAll(TAG)) {
    const idx = m.index ?? 0
    if (idx > last) current().push({ type: 'text', value: source.slice(last, idx) })
    last = idx + m[0].length
    const sigil = m[1]
    const body = m[2]
    if (sigil === '!') continue
    if (sigil === '>') {
      current().push({ type: 'partial', name: body })
    } else if (sigil === '#') {
      const [kind, ...rest] = body.split(/\s+/)
      if (kind !== 'if' || rest.length !== 1)
        throw new TemplateError(`unsupported block: {{#${body}}}`)
      const node: Extract<Node, { type: 'if' }> = {
        type: 'if',
        path: rest[0],
        then: [],
        otherwise: [],
      }
      current().push(node)
      stack.push({ node, inElse: false })
    } else if (sigil === '/') {
      if (body !== 'if' || stack.length === 0) throw new TemplateError(`unexpected {{/${body}}}`)
      stack.pop()
    } else if (body === 'else') {
      const top = stack[stack.length - 1]
      if (!top || top.inElse) throw new TemplateError('unexpected {{else}}')
      top.inElse = true
    } else {
      if (!body) throw new TemplateError('empty {{}} tag')
      current().push({ type: 'var', path: body })
    }
  }
  if (last < source.length) current().push({ type: 'text', value: source.slice(last) })
  if (stack.length > 0) throw new TemplateError('unclosed {{#if}} block')
  return root
}

function lookup(vars: Record<string, unknown>, path: string): { found: boolean; value: unknown } {
  let cur: unknown = vars
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !(key in (cur as Record<string, unknown>))) {
      return { found: false, value: undefined }
    }
    cur = (cur as Record<string, unknown>)[key]
  }
  return { found: true, value: cur }
}

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number') return value !== 0
  return Boolean(value)
}

export interface RenderContext {
  vars: Record<string, unknown>
  partial: (name: string) => Node[] | undefined
}

export function renderNodes(nodes: Node[], ctx: RenderContext, depth = 0): string {
  if (depth > 8) throw new TemplateError('partial nesting too deep')
  let out = ''
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        out += n.value
        break
      case 'var': {
        const r = lookup(ctx.vars, n.path)
        if (!r.found || r.value === undefined || r.value === null) {
          throw new TemplateError(`missing template variable: ${n.path}`)
        }
        out += String(r.value)
        break
      }
      case 'if': {
        const r = lookup(ctx.vars, n.path)
        out += renderNodes(truthy(r.value) ? n.then : n.otherwise, ctx, depth)
        break
      }
      case 'partial': {
        const p = ctx.partial(n.name)
        if (!p) throw new TemplateError(`unknown partial: ${n.name}`)
        out += renderNodes(p, ctx, depth + 1)
        break
      }
    }
  }
  return out
}

/** 列出模板里引用的变量名（含 if 条件里的），用于加载时的静态检查。 */
export function templateVariables(nodes: Node[]): string[] {
  const out = new Set<string>()
  const walk = (list: Node[]) => {
    for (const n of list) {
      if (n.type === 'var') out.add(n.path)
      else if (n.type === 'if') {
        out.add(n.path)
        walk(n.then)
        walk(n.otherwise)
      }
    }
  }
  walk(nodes)
  return [...out].sort()
}

export type { Node as TemplateNode }
