import { describe, expect, it } from 'vitest'
import { canOpenExternally, isAppUrl, isTrustedSender } from '../src/main/navigation.ts'
import { isPermissionAllowed } from '../src/main/permissions.ts'

const origins = new Set(['http://127.0.0.1:5000'])

describe('navigation limits', () => {
  it('only the app origin counts as the app', () => {
    expect(isAppUrl('http://127.0.0.1:5000/projects/1', origins)).toBe(true)
    expect(isAppUrl('http://127.0.0.1:5000.evil.example/', origins)).toBe(false)
    expect(isAppUrl('http://127.0.0.1:5001/', origins)).toBe(false)
    expect(isAppUrl('file:///etc/passwd', origins)).toBe(false)
    expect(isAppUrl('javascript:alert(1)', origins)).toBe(false)
  })

  it('external links open in the system browser only for http(s) and mailto', () => {
    expect(canOpenExternally('https://github.com/hyyyyyyz/dramai')).toBe(true)
    expect(canOpenExternally('http://example.com')).toBe(true)
    expect(canOpenExternally('mailto:a@b.c')).toBe(true)
    for (const bad of [
      'file:///Applications',
      'javascript:alert(1)',
      'ms-msdt:/id',
      'smb://host/share',
      'nope',
    ])
      expect(canOpenExternally(bad)).toBe(false)
  })

  it('IPC senders must be the app page', () => {
    expect(isTrustedSender('http://127.0.0.1:5000/', origins)).toBe(true)
    expect(isTrustedSender('https://evil.example/', origins)).toBe(false)
    expect(isTrustedSender('', origins)).toBe(false)
  })
})

describe('permissions are denied by default', () => {
  it('allows only fullscreen and clipboard write for the app page', () => {
    expect(isPermissionAllowed('fullscreen', 'http://127.0.0.1:5000/', origins)).toBe(true)
    expect(
      isPermissionAllowed('clipboard-sanitized-write', 'http://127.0.0.1:5000/', origins),
    ).toBe(true)
    for (const p of [
      'media',
      'geolocation',
      'notifications',
      'clipboard-read',
      'openExternal',
      'usb',
      'midi',
    ])
      expect(isPermissionAllowed(p, 'http://127.0.0.1:5000/', origins)).toBe(false)
  })
  it('nothing for other origins', () => {
    expect(isPermissionAllowed('fullscreen', 'https://evil.example/', origins)).toBe(false)
  })
})
