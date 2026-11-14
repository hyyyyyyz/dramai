import { COUNTING_MODES, countText, type CallOutput, type CountingMode } from '@dramai/api'

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
    return /^api\.siliconflow\.(cn|com)$/i.test(new URL(baseUrl).hostname)
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
 * How many a text counts for under the server's way of counting, using the contract's own function (`countText` from
 * `@dramai/api`, the one the server judges "too long" with). A way of counting this version doesn't know gives nothing,
 * and the caller then does no local check and leaves it to the pre-flight.
 */
export function countWith(text: string, counting: string | undefined): number | undefined {
  return (COUNTING_MODES as readonly string[]).includes(counting ?? '')
    ? countText(counting as CountingMode, text)
    : undefined
}

/** The style instruction typed so far against the model's limit: the count and the limit, or nothing to compare. */
export function instructionCount(
  inputs: SpeechInputs,
  text: string,
): { n: number; max: number; counting: string; over: boolean } | undefined {
  const { maxLength, counting } = inputs.instructions
  if (!inputs.instructions.supported || maxLength === undefined || counting === undefined)
    return undefined
  // what is saved is the trimmed text, so that is what is counted
  const n = countWith(text.trim(), counting)
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
 * The voice the server uses when none is chosen, from `speechDefaultVoice` of the capability (the same function that
 * generation and the pre-flight use): `known` with the voice and where it comes from (`profile`, or `protocol` for a
 * model without a profile, which has always used `alloy`); `none` when there is no default and generation needs a voice;
 * `unknown` only when the response does not carry the field at all (a server older than this one), and then nothing is
 * concluded and the pre-flight is the one to say. `capability.defaultVoice` is not used for this: it is only what the
 * profile writes, and is empty for a model that still has a default.
 */
export type SpeechDefault =
  | { state: 'known'; voice: string; source: string }
  | { state: 'none' }
  | { state: 'unknown' }
export function speechDefaultOf(view: {
  speechDefaultVoice?: { voice?: string; source: string }
}): SpeechDefault {
  const d = view.speechDefaultVoice
  if (!d) return { state: 'unknown' }
  return d.voice ? { state: 'known', voice: d.voice, source: d.source } : { state: 'none' }
}
