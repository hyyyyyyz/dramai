/**
 * `openai-tts` 的黄金用例（P3d 步骤 0）：输入矩阵 + 响应表。
 *
 * 同一份用例既用来**生成**黄金文件（用 `b29a689`，即语音扩展之前的代码），也用来在每次测试里用**当前**代码重新计算后逐项比较。
 * 协议从参数里传进来，所以生成时可以指向旧代码。
 */

export interface LegacyTtsProtocol {
  buildGenerateRequest(auth: unknown, input: unknown): unknown
  parseGenerateResponse(raw: unknown): unknown
}

const authOf = (baseUrl: string, apiKey: string | undefined, model: string) => ({
  baseUrl,
  model,
  ...(apiKey ? { apiKey } : {}),
  method: 'api_key',
})

const INPUTS: Array<[string, Record<string, unknown>]> = [
  ['minimal', { text: 'x' }],
  ['chinese', { text: '你好，世界。这是一句旁白。' }],
  ['voice-nova', { text: 'x', voice: 'nova' }],
  ['voice-empty-string', { text: 'x', voice: '' }],
  ['format-wav', { text: 'x', format: 'wav' }],
  ['format-ogg', { text: 'x', format: 'ogg' }],
  ['format-mp3', { text: 'x', format: 'mp3' }],
  ['speed-1', { text: 'x', speed: 1 }],
  ['speed-1.25', { text: 'x', speed: 1.25 }],
  ['speed-0', { text: 'x', speed: 0 }],
  ['speed-0.25', { text: 'x', speed: 0.25 }],
  ['speed-4', { text: 'x', speed: 4 }],
  ['empty-text', { text: '' }],
  ['long-text', { text: '字'.repeat(5000) }],
  ['newlines', { text: '第一行\n第二行\n\n第四行' }],
  ['everything', { text: '旁白。', voice: 'onyx', format: 'wav', speed: 0.9 }],
]

const BASES = [
  ['plain', 'https://api.example.com/v1', 'sk-secret', 'tts-1'],
  ['trailing-slash', 'https://api.example.com/v1/', 'sk-secret', 'tts-1-hd'],
  ['no-key', 'https://api.example.com/v1', undefined, 'gpt-4o-mini-tts'],
  ['proxy-path', 'https://gw.example.com/openai/v1///', 'sk-a b', 'my-own-model'],
] as const

const bytes = (...n: number[]) => new Uint8Array(n)

const RESPONSES: Array<[string, Record<string, unknown>]> = [
  [
    'mp3-header',
    { status: 200, headers: { 'content-type': 'audio/mpeg' }, text: '', bytes: bytes(1, 2) },
  ],
  [
    'wav-with-charset',
    {
      status: 200,
      headers: { 'content-type': 'audio/wav; charset=x' },
      text: '',
      bytes: bytes(1, 2),
    },
  ],
  ['ogg', { status: 200, headers: { 'content-type': 'audio/ogg' }, text: '', bytes: bytes(5) }],
  ['x-wav', { status: 200, headers: { 'content-type': 'audio/x-wav' }, text: '', bytes: bytes(5) }],
  ['no-header', { status: 200, headers: {}, text: '', bytes: bytes(1) }],
  [
    'octet-stream',
    {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
      text: '',
      bytes: bytes(1),
    },
  ],
  [
    'json-content-type',
    { status: 200, headers: { 'content-type': 'application/json' }, text: '{}', bytes: bytes(1) },
  ],
  [
    'empty-bytes',
    { status: 200, headers: { 'content-type': 'audio/mpeg' }, text: '', bytes: bytes() },
  ],
  ['missing-bytes', { status: 200, headers: { 'content-type': 'audio/mpeg' }, text: '' }],
]

/** 把结果整理成可以放进 JSON 的样子（字节变成数组）。 */
function plain(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) =>
      v instanceof Uint8Array ? { __bytes: Array.from(v) } : v === undefined ? '__undefined__' : v,
    ),
  )
}

export function computeLegacyTtsGolden(protocol: LegacyTtsProtocol): Record<string, unknown> {
  const requests: Record<string, unknown> = {}
  for (const [bname, baseUrl, key, model] of BASES) {
    for (const [iname, input] of INPUTS) {
      requests[`${bname}/${iname}`] = plain(
        protocol.buildGenerateRequest(authOf(baseUrl, key, model), input),
      )
    }
  }
  const responses: Record<string, unknown> = {}
  for (const [name, raw] of RESPONSES) {
    try {
      responses[name] = plain(protocol.parseGenerateResponse(raw))
    } catch (err) {
      responses[name] = { threw: err instanceof Error ? err.message : String(err) }
    }
  }
  return { requests, responses }
}
