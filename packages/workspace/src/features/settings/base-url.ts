import { useTranslation } from 'react-i18next'
import { errorInfo } from '@/data/errors'

/** The error codes the server answers an address with (creating, creating from a preset, changing the address). */
export const BASE_URL_CODES = [
  'BASE_URL_PLACEHOLDER_UNFILLED',
  'BASE_URL_INVALID',
  'BASE_URL_INSECURE',
  'BASE_URL_NOT_OVERRIDABLE',
] as const
export type BaseUrlCode = (typeof BASE_URL_CODES)[number]

export const baseUrlCodeOf = (error: unknown): BaseUrlCode | undefined => {
  if (!error) return undefined
  const { code } = errorInfo(error)
  return (BASE_URL_CODES as readonly string[]).includes(code) ? (code as BaseUrlCode) : undefined
}

/**
 * The server refuses an address with a query string or a fragment (the request path is appended to the address, so
 * `?x=1` would end up in the middle of it). Saying so right away, with the reason, saves a round trip; the server
 * stays the authority for every other rule.
 */
export const hasQueryOrFragment = (url: string): boolean => /[?#]/.test(url)

/** Can the address be sent at all, as far as this page can tell? */
export const addressSendable = (url: string): boolean =>
  url.trim() !== '' && !hasQueryOrFragment(url)

/**
 * What is wrong with the address as a sentence, or nothing: what this page can see itself, then what the server said
 * about the last attempt. The message is meant to sit under the address input.
 */
export function useBaseUrlMessage(url: string, error: unknown): string | undefined {
  const { t } = useTranslation()
  if (hasQueryOrFragment(url)) return t('baseUrl.error.noQueryOrFragment')
  const code = baseUrlCodeOf(error)
  if (!code) return undefined
  if (code === 'BASE_URL_PLACEHOLDER_UNFILLED') {
    const names =
      (errorInfo(error).details as { placeholders?: string[] } | undefined)?.placeholders ?? []
    if (names.length > 0)
      return t('baseUrl.error.placeholders', {
        names: names.map((n) => `{${n}}`).join(t('providerDialect.listSeparator')),
      })
  }
  return t(`errors.${code}`)
}
