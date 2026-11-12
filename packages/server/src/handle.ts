import { routes } from '@dramai/api'
import type { CallOutput, PathParams, RouteName, Routes } from '@dramai/api'
import type { Context, Hono } from 'hono'
import type { z } from 'zod'
import { badRequest, HttpError } from './errors.ts'

type Opt<T> = T extends z.ZodType ? z.output<T> : undefined

/** 处理函数收到的、已经校验过的输入。 */
export type HandlerInput<N extends RouteName> = {
  params: PathParams<Routes[N]['path']> & Record<string, string>
  query: Opt<Routes[N]['query']>
  /** JSON 请求体（multipart 路由为 undefined）。 */
  body: Routes[N]['body'] extends z.ZodType ? z.output<Routes[N]['body']> : undefined
  /** multipart 路由的表单（JSON 路由为 undefined）。 */
  form: Routes[N]['body'] extends 'multipart' ? FormData : undefined
  c: Context
}

export type RouteHandler<N extends RouteName> = (
  input: HandlerInput<N>,
) => Promise<CallOutput<N>> | CallOutput<N>

/** 修改类，但不改库、或要等外部网络的路由：不占事务（否则会把所有读写挡在外面）。 */
const NO_TRANSACTION: ReadonlySet<RouteName> = new Set<RouteName>([
  'providers.test',
  'generate.preflight',
  'episodes.preflight',
])

const issuesOf = (error: z.ZodError) =>
  error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message }))

/**
 * 把契约（`@dramai/api` 的 `routes`）和实现绑在一起：
 * - 路径参数 / 查询 / 请求体按契约里的 schema 校验，校验失败统一 400；
 * - 处理函数的返回值类型就是契约里的响应类型（漂移在编译期暴露）；
 * - `validateResponses` 打开时（测试里），响应也按 schema 校验，服务端写错字段当场报 500。
 */
export class RouteRegistry {
  readonly registered = new Set<RouteName>()
  private readonly app: Hono
  private readonly validateResponses: boolean
  private readonly store?: { transaction<T>(fn: () => Promise<T>): Promise<T> }

  constructor(
    app: Hono,
    options: {
      validateResponses?: boolean
      /** 给了就启用“每个修改类路由一个事务”（见 `handle` 的注释）。 */
      store?: { transaction<T>(fn: () => Promise<T>): Promise<T> }
    } = {},
  ) {
    this.app = app
    this.validateResponses = options.validateResponses ?? false
    this.store = options.store
  }

  handle<N extends RouteName>(name: N, fn: RouteHandler<N>): void {
    const def = routes[name] as Routes[RouteName]
    if (this.registered.has(name)) throw new Error(`route registered twice: ${name}`)
    this.registered.add(name)
    const method = def.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'
    this.app[method](def.path, async (c) => {
      let query: unknown
      if (def.query) {
        const parsed = def.query.safeParse(c.req.query())
        if (!parsed.success)
          throw new HttpError(400, 'VALIDATION_ERROR', '查询参数不合法', issuesOf(parsed.error))
        query = parsed.data
      }
      let body: unknown
      let form: FormData | undefined
      if (def.body === 'multipart') {
        try {
          form = await c.req.formData()
        } catch {
          throw badRequest('需要 multipart/form-data 请求体')
        }
      } else if (def.body) {
        let raw: unknown
        try {
          raw = await c.req.json()
        } catch {
          throw badRequest('请求体不是合法的 JSON')
        }
        const parsed = def.body.safeParse(raw)
        if (!parsed.success)
          throw new HttpError(400, 'VALIDATION_ERROR', '请求体不合法', issuesOf(parsed.error))
        body = parsed.data
      }
      const run = () =>
        (fn as unknown as (i: unknown) => Promise<unknown>)({
          params: c.req.param(),
          query,
          body,
          form,
          c,
        })
      // 修改类路由整体在一个事务里：读-改-写不会被并发请求穿插（不丢更新），中途失败整体回滚。
      // 事务期间别的读写排队（SQLite 单写者，本地单用户，串行是想要的语义）。
      // 请求体（含上传文件）在进入事务之前已经读完，事务里只做数据库和本地磁盘操作。
      const inTransaction = this.store && def.method !== 'GET' && !NO_TRANSACTION.has(name)
      const result = inTransaction ? await this.store!.transaction(run) : await run()
      if (this.validateResponses) {
        const checked = def.response.safeParse(result)
        if (!checked.success) {
          throw new HttpError(
            500,
            'RESPONSE_SHAPE_MISMATCH',
            `${name} 的响应与契约不符`,
            issuesOf(checked.error),
          )
        }
      }
      return c.json(result as never)
    })
  }

  missing(): RouteName[] {
    return (Object.keys(routes) as RouteName[]).filter((n) => !this.registered.has(n))
  }
}

/** multipart 里取一个文件字段。 */
export async function formFile(
  form: FormData,
  field: string,
): Promise<{ name: string; bytes: Uint8Array; mime: string }> {
  const v = form.get(field)
  if (!(v instanceof File)) throw badRequest(`缺少文件字段 "${field}"`)
  return { name: v.name, bytes: new Uint8Array(await v.arrayBuffer()), mime: v.type }
}

export function formString(form: FormData, field: string): string | undefined {
  const v = form.get(field)
  return typeof v === 'string' ? v : undefined
}

export function stubMissing(registry: RouteRegistry, app: Hono): RouteName[] {
  const missing = registry.missing()
  for (const name of missing) {
    const def = routes[name] as Routes[RouteName]
    const method = def.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'
    app[method](def.path, () => {
      throw new HttpError(501, 'NOT_IMPLEMENTED', `${name} 尚未实现`)
    })
  }
  return missing
}
