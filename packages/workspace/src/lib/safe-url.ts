/**
 * Links and addresses that come from the server (a provider's management page, an authorization address) are only
 * opened when they are plain http or https. Anything else (`javascript:`, `data:`, a malformed string) is refused
 * instead of being put into an href or handed to `window.open`.
 */
export function safeHttpUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined
  } catch {
    return undefined
  }
}
