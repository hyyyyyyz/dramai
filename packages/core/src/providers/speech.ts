import type { NarrationVoice } from '../domain/project.ts'
import type { ModelRegistry } from './catalog.ts'
import { isOfficialSpeechAddress } from './official-hosts.ts'
import { getMediaProtocol } from './protocols/index.ts'
import { countText } from './text-count.ts'
import type {
  LimitDetails,
  ModelCapability,
  ProtocolId,
  ProviderConfig,
  SpeechInput,
  SpeechInputSupport,
} from './types.ts'

/**
 * 旁白配音的输入判断，**只有这一份**：准入（花钱之前）和旁白任务（发请求之前，兜底）用同一个函数。
 * 设计见 research/TTS_PROTOCOL_DESIGN.md。
 *
 * **阻断只用于有官方依据、且确定会失败的情况；推断出来的规则和不确定的情况只警告。**
 * 画像里的限制（音色清单、文本长度、指令长度）是官方对官方接口说的，所以“有画像，并且地址是官方地址”（`strong`）时才阻断；
 * 自填型号（没有画像，哪怕有能力覆盖）、或者经中转站 / 其他地址使用时，同样的发现降为警告（码相同，出现在警告里）。
 * 判断的顺序和原因码：
 * 1. `NARRATION_VOICE_REQUIRED`（**总是阻断**，协议本来就发不出）：没有音色——项目没设置（或设置成空串 / 只有空白，
 *    等于没选；`openai-tts` 除外，它的空串是硅基流动“动态参考音色”的合法写法，保持原样），这个型号又没有默认音色；
 * 2. `VOICE_NOT_AVAILABLE`：画像里音色是**封闭清单**（官方写明就这些），这个音色不在里面；
 * 3. `VOICE_FROM_ANOTHER_SERVICE`：这个音色名在**别家画像的清单**里（换了服务商，原来的 `alloy` 在 MiniMax 上）。只在 `strong` 时才判断；
 * 4. 协议自己的限制（`inputProblem`：硅基流动的音色写法——从官方页面的例子推断，所以没有画像的型号只警告；
 *    CosyVoice 的指令 100 字符、OpenAI 的指令 4096 字符——官方写明）；
 * 5. `TEXT_TOO_LONG`：超过画像里的单次输入字符数上限（`maxPromptChars`，官方写明）。
 * 开放清单（只列了一部分）里没有的音色不拦，给 `VOICE_UNLISTED` 警告：可能是用户自己的克隆音色。
 */

/** 旁白配音输入判断的原因码（准入的原因 / 警告码里也有这几个）。 */
export type SpeechCode =
  | 'NARRATION_VOICE_REQUIRED'
  | 'VOICE_NOT_AVAILABLE'
  | 'VOICE_FROM_ANOTHER_SERVICE'
  | 'VOICE_FORMAT_INVALID'
  | 'INSTRUCTION_TOO_LONG'
  | 'TEXT_TOO_LONG'
  | 'VOICE_UNLISTED'

export interface SpeechProblem {
  code: SpeechCode
  message: string
  /** 超长类原因带结构化的数字：上限、实际值、计数方式。 */
  details?: LimitDetails
}

export interface SpeechJudgement {
  /** 实际会用的音色（项目设置的，或者型号的默认音色）；没有 = 缺。 */
  voice?: string
  /** 用的是型号的默认音色（项目没设置）。 */
  defaulted: boolean
  problems: SpeechProblem[]
  warnings: SpeechProblem[]
}

/** 项目没设置音色时的默认音色：画像里的 `defaultVoice`；没有画像的 `openai-tts` 型号保持一直以来的 `alloy`。 */
export function defaultSpeechVoice(
  protocol: ProtocolId,
  capability: ModelCapability,
): string | undefined {
  return capability.defaultVoice ?? (protocol === 'openai-tts' ? 'alloy' : undefined)
}

const preview = (ids: string[]) => ids.slice(0, 5).join('、') + (ids.length > 5 ? ' 等' : '')

export function judgeSpeech(
  config: Pick<ProviderConfig, 'protocol' | 'model' | 'baseUrl' | 'capabilityOverrides'>,
  models: ModelRegistry,
  input: { text: string; narrationVoice?: NarrationVoice },
): SpeechJudgement {
  const lookup = models.lookup(config)
  const cap = lookup.capability
  // 阻断规则只对“有画像、且在官方地址上”的型号生效；其余降为警告（见文件头）
  const strong =
    lookup.profile !== undefined && isOfficialSpeechAddress(config.protocol, config.baseUrl)
  const nv = input.narrationVoice
  const fallback = defaultSpeechVoice(config.protocol, cap)
  // 空串 / 只有空白 = 没选（openai-tts 除外：空串是硅基流动动态参考音色的合法写法）
  const blank = nv !== undefined && config.protocol !== 'openai-tts' && nv.voice.trim() === ''
  const chosen = nv !== undefined && !blank ? nv.voice : undefined
  const voice = chosen ?? fallback
  const problems: SpeechProblem[] = []
  const warnings: SpeechProblem[] = []
  const defaulted = chosen === undefined && voice !== undefined
  // 不确定的发现：有官方依据的型号在官方地址上阻断，其余只警告
  const find = (p: SpeechProblem) => (strong ? problems : warnings).push(p)

  if (voice === undefined) {
    problems.push({
      code: 'NARRATION_VOICE_REQUIRED',
      message: `${config.model} 没有默认音色，请先在项目里设置旁白音色`,
    })
  } else {
    const list = cap.voices
    const own = new Set((list?.value ?? []).map((v) => v.id))
    const unknown = !own.has(voice)
    if (list?.support === 'supported' && list.value && list.value.length > 0 && unknown) {
      find({
        code: 'VOICE_NOT_AVAILABLE',
        message: `${config.model} 没有音色“${voice}”，可选：${preview(list.value.map((v) => v.id))}${strong ? '' : '（这个地址不是官方地址，服务商可能支持别的音色，所以只是提醒）'}`,
      })
    } else if (strong && unknown) {
      // 别家画像的清单里有这个名字：换了服务商忘了换音色
      const owner = models
        .all()
        .find(
          (p) =>
            p.protocol !== config.protocol &&
            p.capability.media === 'audio' &&
            p.capability.voices?.value?.some((v) => v.id === voice),
        )
      if (owner) {
        problems.push({
          code: 'VOICE_FROM_ANOTHER_SERVICE',
          message: `音色“${voice}”是 ${owner.displayName} 的，${config.model} 用不了；换了服务商后请重新选择旁白音色`,
        })
      }
    }
  }

  const auth = { baseUrl: config.baseUrl, model: config.model }
  const speech: SpeechInput = {
    text: input.text,
    ...(voice !== undefined ? { voice } : {}),
    ...(nv?.instructions ? { instructions: nv.instructions } : {}),
    ...(nv?.language ? { language: nv.language } : {}),
  }
  const protocolProblem = getMediaProtocol(config.protocol).inputProblem?.(auth, speech)
  if (protocolProblem) find(protocolProblem as SpeechProblem)

  const limit = cap.maxPromptChars
  const length = countText('characters', input.text)
  if (limit !== undefined && length > limit) {
    find({
      code: 'TEXT_TOO_LONG',
      message: `旁白有 ${length} 个字符，${config.model} 单次最多 ${limit} 个：请缩短旁白或把镜头拆开${strong ? '' : '（这个地址不是官方地址，上限可能不同，所以只是提醒）'}`,
      details: { limit, actual: length, counting: 'characters' },
    })
  }

  if (
    voice !== undefined &&
    problems.length === 0 &&
    cap.voices?.support === 'unverified' &&
    cap.voices.value &&
    cap.voices.value.length > 0 &&
    !cap.voices.value.some((v) => v.id === voice)
  ) {
    warnings.push({
      code: 'VOICE_UNLISTED',
      message: `音色“${voice}”不在 ${config.model} 的常用音色清单里；如果是你自己的克隆 / 自定义音色就没问题，不存在的话服务商会拒绝`,
    })
  }
  return { voice, defaulted, problems, warnings }
}

/**
 * 这个服务商配置会发哪些可选的语音输入（风格指令、语言提示）和官方上限，给界面用（`providers.capability`）。
 * **和协议实际发送的是同一个来源**（协议自己的 `speechInputs`）；不看画像：没有画像的自填型号按协议和型号名回答。
 * 不是语音协议返回 `undefined`。
 */
export function speechInputSupportOf(
  config: Pick<ProviderConfig, 'protocol' | 'model' | 'baseUrl'>,
): SpeechInputSupport | undefined {
  let protocol: ReturnType<typeof getMediaProtocol>
  try {
    protocol = getMediaProtocol(config.protocol)
  } catch {
    return undefined // 文本协议不是媒体协议
  }
  return protocol.speechInputs?.({ baseUrl: config.baseUrl, model: config.model })
}
