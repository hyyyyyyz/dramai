import { describe, expect, it } from 'vitest'
import { originOf, withAuthHeader } from '../src/main/auth.ts'
import { generateToken } from '../src/main/token.ts'

describe('token', () => {
  it('is long, URL-safe and different each launch', () => {
    const a = generateToken()
    const b = generateToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(32) // the server requires >= 16
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('auth header injection', () => {
  const origins = new Set(['http://127.0.0.1:5000'])
  const token = 'secret-token-secret-token'

  it('adds the bearer token for the app origin only', () => {
    const h = withAuthHeader(
      'http://127.0.0.1:5000/api/projects',
      { Accept: '*/*' },
      origins,
      token,
    )
    expect(h).toEqual({ Accept: '*/*', Authorization: `Bearer ${token}` })
  })

  it('never sends it to another port, host, scheme or look-alike origin', () => {
    for (const url of [
      'http://127.0.0.1:5001/api/projects',
      'http://localhost:5000/api/projects',
      'https://127.0.0.1:5000/',
      'http://127.0.0.1:5000.evil.example/',
      'https://api.openai.com/v1/chat',
      'not a url',
    ]) {
      const h = withAuthHeader(url, { Accept: '*/*' }, origins, token)
      expect(h).toEqual({ Accept: '*/*' })
    }
  })

  it('does not mutate the original headers', () => {
    const original = { Accept: '*/*' }
    withAuthHeader('http://127.0.0.1:5000/', original, origins, token)
    expect(original).toEqual({ Accept: '*/*' })
  })

  it('originOf rejects opaque origins', () => {
    expect(originOf('data:text/html,hi')).toBeUndefined()
    expect(originOf('http://127.0.0.1:5000/a?b=1')).toBe('http://127.0.0.1:5000')
  })
})
