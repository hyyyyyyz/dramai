import type { ProtocolId } from './types.ts'

/**
 * 语音服务商的**官方地址**（官方文档里写的接口主机）。语音输入的阻断规则只对“有画像、且在官方地址上”的型号生效：
 * 画像里的限制（音色清单、文本长度）是官方对官方接口说的，经过中转站时中转站可能支持别的音色、别的长度，
 * 那时这些规则只给警告，不阻断。
 *
 * - OpenAI：`api.openai.com`（speech 参考页）；
 * - 硅基流动：`api.siliconflow.cn` / `api.siliconflow.com`（`audio-speech-post` 页、国际站语音指南）；
 * - MiniMax：`api.minimax.cn` / `api.minimax.io`（同步语音合成页）；
 * - 阿里 CosyVoice：`<业务空间>.cn-beijing.maas.aliyuncs.com`（HTTP 非实时页）。
 */
const OFFICIAL: ReadonlyArray<readonly [ProtocolId, RegExp]> = [
  ['openai-tts', /^api\.openai\.com$/],
  ['openai-tts', /^api\.siliconflow\.(cn|com)$/],
  ['minimax-t2a', /^api\.minimax\.(cn|io)$/],
  ['dashscope-cosyvoice', /^[^.]+\.cn-beijing\.maas\.aliyuncs\.com$/],
]

export function isOfficialSpeechAddress(protocol: ProtocolId, baseUrl: string): boolean {
  let host: string
  try {
    host = new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return false
  }
  return OFFICIAL.some(([p, re]) => p === protocol && re.test(host))
}
