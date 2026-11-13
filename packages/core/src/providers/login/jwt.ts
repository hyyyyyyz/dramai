import { createPublicKey, verify } from 'node:crypto'

/**
 * ID token 验签（RS256），只用 node:crypto，不引入依赖。
 * 只做"登录"需要的：解析、按 `kid` 找 JWKS 里的公钥、验签名、取出 claims；
 * claims 的业务校验（签发方、受众、到期、nonce）在调用方，见 `verifyIdToken`。
 */

export interface Jwk {
  kty: string
  kid?: string
  use?: string
  alg?: string
  n?: string
  e?: string
  [k: string]: unknown
}

export type JwtClaims = Record<string, unknown>

export class JwtError extends Error {
  readonly code: 'malformed' | 'unsupported_alg' | 'unknown_key' | 'bad_signature'
  constructor(code: JwtError['code'], message: string) {
    super(message)
    this.name = 'JwtError'
    this.code = code
  }
}

const b64urlToBuffer = (s: string): Buffer => Buffer.from(s, 'base64url')

export interface ParsedJwt {
  header: { alg?: string; kid?: string; typ?: string }
  claims: JwtClaims
  signingInput: string
  signature: Buffer
}

export function parseJwt(token: string): ParsedJwt {
  const parts = token.split('.')
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    throw new JwtError('malformed', 'ID token 格式不对')
  }
  try {
    const header = JSON.parse(b64urlToBuffer(parts[0]!).toString('utf8')) as ParsedJwt['header']
    const claims = JSON.parse(b64urlToBuffer(parts[1]!).toString('utf8')) as JwtClaims
    if (!header || typeof header !== 'object' || !claims || typeof claims !== 'object') {
      throw new Error('not an object')
    }
    return {
      header,
      claims,
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: b64urlToBuffer(parts[2]!),
    }
  } catch (err) {
    throw new JwtError(
      'malformed',
      `ID token 解析失败：${err instanceof Error ? err.message : err}`,
    )
  }
}

/** 用 JWKS 验 RS256 签名。`alg` 只接受 RS256（官方发现文档里 id_token_signing_alg_values_supported）。 */
export function verifyJwtSignature(parsed: ParsedJwt, keys: readonly Jwk[]): void {
  if (parsed.header.alg !== 'RS256') {
    throw new JwtError('unsupported_alg', `不支持的签名算法：${String(parsed.header.alg)}`)
  }
  const candidates = parsed.header.kid
    ? keys.filter((k) => k.kid === parsed.header.kid)
    : keys.filter((k) => k.kty === 'RSA')
  const key = candidates.find((k) => k.kty === 'RSA')
  if (!key) throw new JwtError('unknown_key', '签名密钥不在发布的 JWKS 里')
  let ok: boolean
  try {
    ok = verify(
      'RSA-SHA256',
      Buffer.from(parsed.signingInput),
      createPublicKey({ key: key as never, format: 'jwk' }),
      parsed.signature,
    )
  } catch {
    ok = false
  }
  if (!ok) throw new JwtError('bad_signature', 'ID token 签名不对')
}
