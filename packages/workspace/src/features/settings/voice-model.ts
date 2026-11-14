import type { CallOutput } from '@dramai/api'

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

/** What a speech model takes besides the voice, as the server reports it (`speechInputs` of the capability). */
export type SpeechInputs = NonNullable<CallOutput<'providers.capability'>['speechInputs']>
/** A model that reports nothing takes neither input. */
export const NO_SPEECH_INPUTS: SpeechInputs = {
  instructions: { supported: false },
  language: { supported: false },
}

/**
 * How many a text counts for under the way the server says it counts: `characters` (code points) or `cjk_double`
 * (a Chinese or full-width character counts as 2). A way of counting this version doesn't know gives nothing, and the
 * caller then does no local check and leaves it to the pre-flight.
 */
export function countText(text: string, counting: string | undefined): number | undefined {
  if (counting === 'characters') return [...text].length
  if (counting === 'cjk_double') {
    let n = 0
    for (const ch of text) n += /[⺀-鿿豈-﫿＀-￯]/.test(ch) ? 2 : 1
    return n
  }
  return undefined
}

/** The style instruction typed so far against the model's limit: the count and the limit, or nothing to compare. */
export function instructionCount(
  inputs: SpeechInputs,
  text: string,
): { n: number; max: number; counting: string; over: boolean } | undefined {
  const { maxLength, counting } = inputs.instructions
  if (!inputs.instructions.supported || maxLength === undefined || counting === undefined)
    return undefined
  const n = countText(text, counting)
  return n === undefined ? undefined : { n, max: maxLength, counting, over: n > maxLength }
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
