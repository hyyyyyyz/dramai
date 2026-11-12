import { DEFAULT_LOCALE, localeFromAcceptLanguage, normalizeLocale } from '@dramai/core'
import type { Locale } from '@dramai/core'
import type { Context } from 'hono'
import type { ServerContext } from './context.ts'

/**
 * 这次请求要哪种语言的内置数据。顺序：
 * 1. 请求明确指定：`?lang=en` 或请求头 `X-Dramai-Locale: en`（客户端的 `locale` 选项）；
 * 2. 应用设置里的界面语言（`settings.locale`）；
 * 3. `Accept-Language`；
 * 4. 中文。
 * 用户自己填写的内容永远原样返回，只有内置数据按它翻译。
 */
export async function localeOf(ctx: ServerContext, c: Context): Promise<Locale> {
  const explicit =
    normalizeLocale(c.req.query('lang')) ?? normalizeLocale(c.req.header('x-dramai-locale'))
  if (explicit) return explicit
  const saved = normalizeLocale((await ctx.settings.get()).locale)
  if (saved) return saved
  return localeFromAcceptLanguage(c.req.header('accept-language')) ?? DEFAULT_LOCALE
}
