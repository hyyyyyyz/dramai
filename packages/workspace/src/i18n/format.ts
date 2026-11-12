import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'

/**
 * 日期、数字、时长、金额都按当前语言格式化（Intl），文案里不拼接数字和单位。
 * 纯函数，传入 locale 和 t；组件里用 useFormat() 拿到已绑定的一组。
 */

const DAY = 86_400_000

export function formatNumber(
  locale: string,
  n: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(n)
}

export function formatDateTime(locale: string, ts: number): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(ts)
}

/** 今天 14:32 / 昨天 21:07 / 11 月 8 日：项目列表的“最近更新”。 */
export function formatUpdated(locale: string, ts: number, now: number): string {
  const startOfDay = (t: number) => {
    const d = new Date(t)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  const dayDiff = Math.round((startOfDay(ts) - startOfDay(now)) / DAY)
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(ts)
  if (dayDiff === 0 || dayDiff === -1) {
    const word = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(dayDiff, 'day')
    return `${word} ${time}`
  }
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear()
  return new Intl.DateTimeFormat(
    locale,
    sameYear
      ? { month: 'long', day: 'numeric' }
      : { year: 'numeric', month: 'long', day: 'numeric' },
  ).format(ts)
}

/** “3 分钟前”这类相对时间。 */
export function formatAgo(locale: string, ts: number, now: number): string {
  const sec = Math.round((ts - now) / 1000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const abs = Math.abs(sec)
  if (abs < 45) return rtf.format(0, 'second')
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute')
  if (abs < DAY / 1000) return rtf.format(Math.round(sec / 3600), 'hour')
  return rtf.format(Math.round(sec / (DAY / 1000)), 'day')
}

/** 时长：1 分 12 秒 / 1 min 12 s。 */
export function formatDuration(t: TFunction, ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return t('format.durationHm', { h, m })
  if (m > 0) return t('format.durationMs', { m, s })
  return t('format.durationS', { s })
}

/** 字数：中文用“万 / 千字”，其他语言用紧凑记数。 */
export function formatChars(locale: string, t: TFunction, count: number): string {
  if (locale.startsWith('zh')) {
    if (count >= 10_000)
      return t('format.charsApprox', {
        value: `${(count / 10_000).toFixed(1).replace(/\.0$/, '')} ${locale === 'zh-TW' ? '萬' : '万'}`,
      })
    if (count >= 1000) return t('format.charsApprox', { value: `${Math.round(count / 1000)} 千` })
    return t('format.chars', { value: formatNumber(locale, count) })
  }
  const compact = formatNumber(locale, count, { notation: 'compact', maximumFractionDigits: 1 })
  return count >= 1000
    ? t('format.charsApprox', { value: compact })
    : t('format.chars', { value: formatNumber(locale, count) })
}

const ISO_CURRENCIES = new Set(Intl.supportedValuesOf('currency'))

/** 金额：ISO 币种用 Intl；PTC 这类服务商点数不是 ISO 币种，写成“数值 单位”。 */
export function formatMoney(locale: string, amount: number, currency: string): string {
  if (!ISO_CURRENCIES.has(currency.toUpperCase()))
    return `${formatNumber(locale, amount, { maximumFractionDigits: 4 })} ${currency}`
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: amount < 1 ? 4 : 2,
  }).format(amount)
}

export function useFormat() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  return useMemo(
    () => ({
      locale,
      number: (n: number, o?: Intl.NumberFormatOptions) => formatNumber(locale, n, o),
      dateTime: (ts: number) => formatDateTime(locale, ts),
      updated: (ts: number, now = Date.now()) => formatUpdated(locale, ts, now),
      ago: (ts: number, now = Date.now()) => formatAgo(locale, ts, now),
      duration: (ms: number) => formatDuration(t, ms),
      chars: (n: number) => formatChars(locale, t, n),
      money: (amount: number, currency: string) => formatMoney(locale, amount, currency),
    }),
    [locale, t],
  )
}
