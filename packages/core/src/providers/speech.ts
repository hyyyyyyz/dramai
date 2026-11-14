import type { NarrationVoice } from '../domain/project.ts'
import type { ModelRegistry } from './catalog.ts'
import { getMediaProtocol } from './protocols/index.ts'
import type { ModelCapability, ProtocolId, ProviderConfig, SpeechInput } from './types.ts'

/**
 * 旁白配音的输入判断，**只有这一份**：准入（花钱之前）和旁白任务（发请求之前，兜底）用同一个函数。
 * 设计见 research/TTS_PROTOCOL_DESIGN.md。
 *
 * 判断的顺序和原因码：
 * 1. `NARRATION_VOICE_REQUIRED`：项目没设置音色，这个型号又没有默认音色；
 * 2. `VOICE_NOT_AVAILABLE`：画像里音色是**封闭清单**（官方写明就这些），这个音色不在里面；
 * 3. `VOICE_FROM_ANOTHER_SERVICE`：这个音色名在**别家画像的清单**里（换了服务商，原来的 `alloy` 在 MiniMax 上）。
 *    只对有画像的型号判断；没有画像的自填型号（常见的是各种中转）什么都可能，不拦；
 * 4. 协议自己的限制（`inputProblem`：硅基流动的音色写法、CosyVoice 的指令长度）；
 * 5. `TEXT_TOO_LONG`：超过画像里的单次输入字符数上限（`maxPromptChars`）。
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
  const nv = input.narrationVoice
  const fallback = defaultSpeechVoice(config.protocol, cap)
  const voice = nv?.voice ?? fallback
  const problems: SpeechProblem[] = []
  const warnings: SpeechProblem[] = []
  const defaulted = nv === undefined && voice !== undefined

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
      problems.push({
        code: 'VOICE_NOT_AVAILABLE',
        message: `${config.model} 没有音色“${voice}”，可选：${preview(list.value.map((v) => v.id))}`,
      })
    } else if (lookup.declared && unknown) {
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
  if (protocolProblem) problems.push(protocolProblem as SpeechProblem)

  const limit = cap.maxPromptChars
  const length = [...input.text].length
  if (limit !== undefined && length > limit) {
    problems.push({
      code: 'TEXT_TOO_LONG',
      message: `旁白有 ${length} 个字符，${config.model} 单次最多 ${limit} 个：请缩短旁白或把镜头拆开`,
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
      message: `音色“${voice}”不在 ${config.model} 的常用音色清单里；如果是你自己的克隆 / 自定义音色就没问题，不存在的话服务商会拒绝（不收费）`,
    })
  }
  return { voice, defaulted, problems, warnings }
}
