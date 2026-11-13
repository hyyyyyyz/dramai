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

describe('checkBaseUrl: tightened rules', () => {
  it('rejects a query string or a fragment (the request path is appended after the address)', () => {
    for (const bad of [
      'https://a.com/v1?x=1',
      'https://a.com/v1?',
      'https://a.com/v1#frag',
      'https://a.com#',
    ])
      expect(checkBaseUrl(bad), bad).toMatchObject({ ok: false, code: 'BASE_URL_INVALID' })
  })

  it('sees percent-encoded braces as placeholders', () => {
    for (const bad of [
      'https://%7BWorkspaceId%7D.cn-beijing.maas.aliyuncs.com',
      'https://%7bWorkspaceId%7d.example.com',
      'https://x.example.com/%7Bregion%7D/v1',
    ])
      expect(checkBaseUrl(bad), bad).toMatchObject({
        ok: false,
        code: 'BASE_URL_PLACEHOLDER_UNFILLED',
      })
    expect(checkBaseUrl('https://%7BWorkspaceId%7D.example.com')).toMatchObject({
      placeholders: ['WorkspaceId'],
    })
  })

  it('link-local addresses (incl. the cloud metadata address) are not "the local network" for plain http', () => {
    for (const bad of [
      'http://169.254.169.254/latest/meta-data',
      'http://169.254.0.1/v1',
      'http://[fe80::1]/v1',
      'http://[fd00:ec2::254]/v1',
      'http://2852039166/v1', // 169.254.169.254 written as one decimal number
    ])
      expect(checkBaseUrl(bad), bad).toMatchObject({ ok: false, code: 'BASE_URL_INSECURE' })
    expect(isLocalNetworkHost('169.254.1.1')).toBe(false)
    // ...while ordinary local addresses still pass
    for (const ok of [
      'http://192.168.1.2/v1',
      'http://[fd12:3456::1]/v1',
      'http://localhost:11434/v1',
    ])
      expect(checkBaseUrl(ok).ok, ok).toBe(true)
  })
})

describe('checkBaseUrl: cloud metadata hosts never count as the local network', () => {
  it('plain http to a metadata name or address is refused, https is still allowed', () => {
    for (const bad of [
      'http://metadata.google.internal/computeMetadata/v1',
      'http://metadata/v1',
      'http://METADATA.GOOGLE.INTERNAL./v1',
      'http://100.100.100.200/latest/meta-data',
      'http://instance-data/latest',
      'http://instance-data.ec2.internal/latest',
      'http://metadata.tencentyun.com/latest/meta-data',
    ])
      expect(checkBaseUrl(bad), bad).toMatchObject({ ok: false, code: 'BASE_URL_INSECURE' })
    // ordinary neighbours of those ranges and names are unaffected
    for (const ok of [
      'http://100.100.100.201/v1',
      'http://100.64.0.5/v1',
      'http://my-metadata-box/v1',
      'http://gpu.internal/v1',
    ])
      expect(checkBaseUrl(ok).ok, ok).toBe(true)
  })
})
