import { asRecord, joinUrl, jsonHeaders, jsonPost, str } from '../http.ts'
import type { MediaProtocol, RawResponse, SpeechInput, SpeechInputSupport } from '../types.ts'
import { capabilityError } from './content-array.ts'

/**
 * MiniMax 同步语音合成（T2A v2）。依据：MiniMax 平台“同步语音合成”“错误码”“系统音色”页（2026-11-13 核对）。**未实测。**
 *
 *   POST {baseUrl}/t2a_v2            头 Authorization: Bearer <Key>（两处文档都没有 GroupId）
 *     { model, text, stream:false, voice_setting:{ voice_id, speed }, audio_setting:{ format },
 *       output_format:"hex", language_boost? }
 *     → { data:{ audio:"<十六进制>", status:2 }, extra_info:{…}, base_resp:{ status_code, status_msg } }
 *
 * baseUrl 带 `/v1`（国内 `https://api.minimax.cn/v1`，国际 `https://api.minimax.io/v1`；与 MiniMax 文本 / 生图预设一致）。
 *
 * - **HTTP 200 也可能是失败**：`base_resp.status_code !== 0`，带稳定码 `MINIMAX_<码>` 返回。只有确定没有产生费用的类别
 *   （鉴权、额度、限流、参数、输入审核、音色不存在，见 `MINIMAX_REJECTED_CODES`）才算“明确拒绝”；其余（超时、内部错误、输出侧失败…）
 *   按“结果不明、可能已计费”处理；
 * - 音频是十六进制字符串，**在这里解码成字节**；不是合法的十六进制 = 解析失败（响应读不懂），不当成空音频；
 * - `output_format` 固定 `hex`：URL（24 小时有效）要再下载一次，同步字节更简单；
 * - 单次文本须小于 10000 字符（准入按画像拦，这里不重复检查）；语速官方范围 0.5–2，超出会被夹到范围内（`ignoredInputs` 报告）；
 * - 没有对应字段的输入（`instructions`）丢弃并报告；`language` 只映射官方页面列出的四个写法，其余丢弃并报告。
 */

const FORMAT: Record<
  NonNullable<SpeechInput['format']>,
  { format: string; mime: string } | undefined
> = {
  mp3: { format: 'mp3', mime: 'audio/mpeg' },
  wav: { format: 'wav', mime: 'audio/wav' },
  ogg: undefined, // 官方 opus 的封装没有写明，不猜
}

/** `language_boost` 的写法：只放官方页面里读到的几个。 */
const LANGUAGE_BOOST: Record<string, string> = {
  zh: 'Chinese',
  yue: 'Chinese,Yue',
  en: 'English',
  ja: 'Japanese',
}

const SPEED = { min: 0.5, max: 2 }
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** 稳定码：`MINIMAX_<base_resp.status_code>`。 */
const codeOf = (statusCode: unknown): string => `MINIMAX_${String(statusCode)}`

/**
 * **只有能确定没有产生费用的类别才算“明确拒绝”**（`rejected: true`：重试不需要用户确认“可能再次计费”）。
 * 官方错误码页（platform.minimax.io/docs/api-reference/errorcode，2026-11-13）**没有写任何一个码是否计费**，
 * 所以这里的依据是页面对这些码的描述：它们都是请求被处理**之前**的校验——鉴权、余额 / 额度、限流、参数、输入内容审核、
 * 音色不存在。表里每个码后面是页面上的说法。
 *
 * 不在表里的码一律按“结果不明、可能已计费”处理（`submission: 'unknown'`，带稳定码），重试需要用户确认。
 * 其中特别是：1000 未知错误、1001 请求超时、1024 内部错误、1033 系统 / 数据库错误、2064 集群高负载、2066 处理中超时
 * （服务端可能已经处理甚至计费），1027 输出被判敏感（输出侧失败，合成已经发生），以及页面上没有的新码。
 */
export const MINIMAX_REJECTED_CODES: Readonly<Record<number, string>> = {
  // 鉴权
  1004: 'Not authorized (token mismatch, missing cookie, or login needed)',
  2049: 'Invalid API key',
  2057: 'Not an M Plan token',
  // 余额 / 额度 / 套餐
  1008: 'Insufficient balance',
  2053: 'Insufficient credit',
  2056: 'Usage limit exceeded',
  2067: 'Usage limit reached and credit auto-consumption off',
  2061: "Current plan doesn't support the model",
  2068: "Plan tier doesn't support the model",
  2069: 'Model no longer available',
  // 限流 / 用量增长限制
  1002: 'Rate limit',
  1039: 'Token limit',
  1041: 'Connection limit',
  2045: 'Rate growth limit',
  2046: 'Token growth limit',
  2047: 'Connection growth limit',
  2062: 'M Plan rate limit reached',
  // 参数
  2013: 'Invalid parameters',
  2014: 'Empty input',
  2022: 'Model does not exist',
  // 输入内容被拒（输入侧审核，合成没有开始）
  1026: 'Input flagged as sensitive',
  1042: 'Too many invisible or illegal characters',
  // 音色不存在 / 不可用
  20132: 'Invalid samples or voice_id',
  2054: 'voice_id does not exist',
  2042: 'No access to this voice_id',
  2043: "Model doesn't support this voice_id",
}

const isRejected = (statusCode: unknown): boolean => {
  const n = typeof statusCode === 'number' ? statusCode : Number(statusCode)
  return Number.isInteger(n) && Object.hasOwn(MINIMAX_REJECTED_CODES, n)
}

/** 官方错误码页上读到的几类，给 `status_msg` 补一句人话（原文始终保留）。 */
function hintFor(statusCode: number): string {
  switch (statusCode) {
    case 1004:
    case 2049:
      return '鉴权失败：检查 API Key 是否正确、是否属于这个站点（国内 / 国际站的 Key 按不互通处理）'
    case 1008:
    case 2053:
      return '余额不足'
    case 1002:
    case 1039:
    case 2045:
    case 2046:
      return '请求太快或用量增长太快，稍后再试'
    case 1026:
      return '输入被判为敏感内容'
    case 1027:
      return '输出被判为敏感内容；服务端可能已经处理，重试前请到后台核对用量'
    case 1042:
      return '输入里的不可见字符或非法字符太多'
    case 2013:
      return '请求参数不合法'
    case 2014:
      return '输入为空'
    case 2022:
      return '型号不存在或没有权限'
    case 20132:
    case 2054:
    case 2042:
      return '音色不存在或没有使用权限'
    case 2043:
      return '这个型号不支持该音色'
    case 2056:
    case 2067:
      return '用量已达上限'
    case 1001:
    case 2066:
      return '服务端处理超时；请求可能已经处理甚至计费，重试前请到后台核对用量'
    case 2064:
    case 1000:
    case 1024:
    case 1033:
      return '服务暂时不可用；请求可能已经处理，重试前请到后台核对用量'
    default:
      return ''
  }
}

function failureOf(statusCode: unknown, msg: unknown): { message: string; code: string } {
  const n = typeof statusCode === 'number' ? statusCode : Number(statusCode)
  const hint = Number.isFinite(n) ? hintFor(n) : ''
  const original = str(msg)
  return {
    code: codeOf(statusCode),
    message: `MiniMax 错误 ${String(statusCode)}${hint ? `（${hint}）` : ''}${original ? `：${original}` : ''}`,
  }
}

/** 十六进制字符串 → 字节；不是合法的十六进制就返回 undefined。 */
export function hexToBytes(hex: string): Uint8Array | undefined {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return undefined
  return new Uint8Array(Buffer.from(hex, 'hex'))
}

/** 响应里没有请求信息，成品的类型按响应自己的 `extra_info.audio_format` 回读，缺省 mp3（旁白只请求 mp3）。 */
function mimeOfFormat(format: unknown): string {
  switch (typeof format === 'string' ? format.toLowerCase() : '') {
    case 'wav':
      return 'audio/wav'
    case 'flac':
      return 'audio/flac'
    default:
      return 'audio/mpeg'
  }
}

/** 这个协议会发哪些可选输入：没有风格指令的对应字段；语言提示映射到 `language_boost`（只映射官方页面读到的几个写法）。 */
const INPUTS: SpeechInputSupport = {
  instructions: { supported: false },
  language: { supported: true },
}

export const minimaxT2a: MediaProtocol<SpeechInput> = {
  id: 'minimax-t2a',
  media: 'audio',
  speechInputs: () => INPUTS,

  buildGenerateRequest(auth, input) {
    if (!input.voice) {
      throw capabilityError(
        'VOICE_REQUIRED',
        'MiniMax 的语音合成必须指定音色（voice_id），请先设置旁白音色',
      )
    }
    const format = FORMAT[input.format ?? 'mp3']
    if (!format) {
      throw capabilityError(
        'FORMAT_UNSUPPORTED',
        `MiniMax 这一版只发 mp3 / wav，不发 ${input.format}`,
      )
    }
    const voiceSetting: Record<string, unknown> = { voice_id: input.voice }
    if (input.speed) voiceSetting.speed = clamp(input.speed, SPEED.min, SPEED.max)
    const body: Record<string, unknown> = {
      model: auth.model,
      text: input.text,
      stream: false,
      voice_setting: voiceSetting,
      audio_setting: { format: format.format },
      output_format: 'hex',
    }
    const boost = input.language ? LANGUAGE_BOOST[input.language.toLowerCase()] : undefined
    if (boost) body.language_boost = boost
    return jsonPost(joinUrl(auth.baseUrl, '/t2a_v2'), body, jsonHeaders(auth.apiKey))
  },

  parseGenerateResponse(raw) {
    const json = asRecord(raw.json)
    if (!json) return { status: 'failed', message: 'MiniMax 返回的不是 JSON' }
    const base = asRecord(json.base_resp)
    if (base && base.status_code !== undefined && Number(base.status_code) !== 0) {
      // 只有确定没有产生费用的类别才声明“明确拒绝”；其余带着稳定码按“结果不明”处理（重试要用户确认）
      return {
        status: 'failed',
        ...(isRejected(base.status_code) ? { rejected: true } : {}),
        ...failureOf(base.status_code, base.status_msg),
      }
    }
    const data = asRecord(json.data)
    const audio = str(data?.audio)
    if (!audio) {
      return { status: 'failed', message: 'MiniMax 响应里没有音频（data.audio 缺失或为空）' }
    }
    if (data?.status === 1) {
      return { status: 'failed', message: 'MiniMax 响应里音频还没有合成完（data.status = 1）' }
    }
    const bytes = hexToBytes(audio)
    if (!bytes) {
      return { status: 'failed', message: 'MiniMax 返回的音频不是合法的十六进制字符串，无法解码' }
    }
    const info = asRecord(json.extra_info)
    return {
      status: 'sync',
      outputs: [{ kind: 'bytes', bytes, mime: mimeOfFormat(info?.audio_format) }],
    }
  },

  parseHttpError(raw: RawResponse) {
    const json = asRecord(raw.json)
    const base = asRecord(json?.base_resp)
    // 限流、服务端临时错误可以稍后再试；鉴权、余额、参数不行
    const transient = raw.status === 429 || raw.status >= 500
    if (base && base.status_code !== undefined) {
      const f = failureOf(base.status_code, base.status_msg)
      return { code: f.code, message: f.message, recoverable: transient }
    }
    const err = asRecord(json?.error)
    const message = str(err?.message) ?? str(json?.message)
    return { ...(message ? { message } : {}), recoverable: transient }
  },

  ignoredInputs(_auth, input) {
    const out: string[] = []
    if (input.instructions && !INPUTS.instructions.supported) out.push('instructions')
    if (input.language && !LANGUAGE_BOOST[input.language.toLowerCase()]) out.push('language')
    if (input.speed && (input.speed < SPEED.min || input.speed > SPEED.max)) out.push('speed')
    return out
  },
}
