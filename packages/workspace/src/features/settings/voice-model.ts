import type { CallOutput } from '@dramai/api'
import type { ProtocolId } from './protocols'

type Capability = CallOutput<'providers.capability'>['capability']

/**
 * The narration voice list of a speech model, as the interface has to treat it:
 * - `closed`: the model has exactly these voices (pick from the list);
 * - `open`: the list only names the common ones, others can be typed (a cloned or custom voice, for example);
 * - `none`: the model has no system voices (or the list is not known): the voice can only be typed, or does not apply.
 */
export type VoiceListKind = 'closed' | 'open' | 'none'

export const voiceListKind = (cap: Capability | undefined): VoiceListKind => {
  const v = cap?.voices
  if (!v || !v.value || v.value.length === 0) return 'none'
  if (v.support === 'supported') return 'closed'
  if (v.support === 'unverified') return 'open'
  return 'none'
}

export const voicesOf = (cap: Capability | undefined) => cap?.voices?.value ?? []

/** The speech address is SiliconFlow's: its voices are written "model:voice". */
export const isSiliconflow = (baseUrl: string): boolean => {
  try {
    return /(^|\.)siliconflow\.(cn|com)$/i.test(new URL(baseUrl).hostname)
  } catch {
    return false
  }
}

/**
 * SiliconFlow wants "model:voice" (or a `speech:…` address from an uploaded reference audio). Mirrors the server's
 * check, which stays the authority: the point here is to say so while the user is typing.
 */
export function voiceFormatProblem(baseUrl: string, model: string, voice: string): boolean {
  if (!isSiliconflow(baseUrl)) return false
  const v = voice.trim()
  return !(v === '' || v.startsWith('speech:') || v.startsWith(`${model}:`))
}

/**
 * Which optional narration inputs the model really sends (from the request builders): a style instruction goes out for
 * OpenAI's `gpt-4o-mini-tts*` and CosyVoice, a language hint for MiniMax and CosyVoice. The others drop what was
 * typed and list it in the task result's `ignoredInputs`.
 */
export function speechInputSupport(
  protocol: ProtocolId,
  model: string,
): { instructions: boolean; language: boolean } {
  switch (protocol) {
    case 'openai-tts':
      return { instructions: /^gpt-4o-mini-tts/i.test(model), language: false }
    case 'minimax-t2a':
      return { instructions: false, language: true }
    case 'dashscope-cosyvoice':
      return { instructions: true, language: true }
    default:
      return { instructions: false, language: false }
  }
}

/** CosyVoice's limit on the style instruction: 100 characters, a Chinese (full-width) character counts for 2. */
export const INSTRUCTION_MAX = 100
export function instructionWeight(text: string): number {
  let n = 0
  for (const ch of text) n += /[⺀-鿿豈-﫿＀-￯]/.test(ch) ? 2 : 1
  return n
}

export type VoiceFit =
  /** nothing to say */
  | 'fine'
  /** a closed list that does not have it */
  | 'not_in_list'
  /** an open list that does not name it (may still be a custom voice) */
  | 'unlisted'

/** Does the chosen voice exist on this model? A voice that is empty falls back to the default and is fine. */
export function voiceFit(cap: Capability | undefined, voice: string | undefined): VoiceFit {
  if (!voice) return 'fine'
  const kind = voiceListKind(cap)
  if (kind === 'none') return 'fine'
  const known = voicesOf(cap).some((v) => v.id === voice)
  if (known) return 'fine'
  return kind === 'closed' ? 'not_in_list' : 'unlisted'
}

/**
 * Why a voice that was chosen for one speech provider does not work on another: it is in the old provider's list
 * ("belongs to the other service"), or the new one simply has no such voice.
 */
export function voiceMismatch(
  next: Capability | undefined,
  previous: Capability | undefined,
  voice: string,
): 'from_another_service' | 'not_available' | undefined {
  if (voiceFit(next, voice) !== 'not_in_list') return undefined
  const inPrevious = voicesOf(previous).some((v) => v.id === voice)
  return inPrevious ? 'from_another_service' : 'not_available'
}
