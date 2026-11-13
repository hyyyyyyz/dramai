import { describe, expect, it } from 'vitest'
import { checkBaseUrl, isLocalNetworkHost } from '../src/providers/base-url.ts'

describe('checkBaseUrl', () => {
  it('accepts https anywhere and keeps the trimmed address', () => {
    expect(checkBaseUrl('  https://api.example.com/v1 ')).toEqual({
      ok: true,
      url: 'https://api.example.com/v1',
    })
  })

  it('reports every unreplaced placeholder', () => {
    expect(checkBaseUrl('https://{WorkspaceId}.{Region}.example.com')).toMatchObject({
      ok: false,
      code: 'BASE_URL_PLACEHOLDER_UNFILLED',
      placeholders: ['WorkspaceId', 'Region'],
    })
  })

  it('rejects things that are not http(s) addresses', () => {
    for (const bad of ['', 'ftp://x.com', 'x.com/v1', 'https://u:p@x.com', 'https://x .com'])
      expect(checkBaseUrl(bad), bad).toMatchObject({ ok: false, code: 'BASE_URL_INVALID' })
  })

  it('allows plain http only to this machine or the LAN', () => {
    expect(checkBaseUrl('http://example.com')).toMatchObject({ code: 'BASE_URL_INSECURE' })
    expect(checkBaseUrl('http://localhost:11434/v1').ok).toBe(true)
    for (const h of [
      '127.0.0.1',
      '192.168.0.2',
      '10.1.2.3',
      '172.20.0.1',
      '100.100.1.1',
      'box',
      'a.local',
    ])
      expect(isLocalNetworkHost(h), h).toBe(true)
    for (const h of ['8.8.8.8', '172.32.0.1', '100.128.0.1', 'example.com', '11.0.0.1'])
      expect(isLocalNetworkHost(h), h).toBe(false)
  })
})
