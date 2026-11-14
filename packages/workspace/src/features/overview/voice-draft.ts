import type { Project } from '@dramai/api'

/** The marker of the voice select for "type another voice". */
export const OTHER = '__other__'

export type VoiceDraft = {
  voice: string
  instructions: string
  language: string
  /** The user asked to clear every narration setting (voice, instruction, language and speed). */
  clearAll: boolean
}

/** What the dialog shows for a saved narration voice: the text as it will be compared, without stray whitespace. */
export const draftOfVoice = (v: Project['narrationVoice']): VoiceDraft => ({
  voice: v?.voice.trim() ?? '',
  instructions: v?.instructions?.trim() ?? '',
  language: v?.language?.trim() ?? '',
  clearAll: false,
})

type NarrationVoiceBody = {
  providerConfigId: string
  voice: string
  speed?: number
  instructions?: string
  language?: string
}

export type VoiceOutcome =
  /** the user did not touch the voice section: nothing about it goes in the request */
  | { kind: 'none' }
  /** clear every narration setting (only when asked, or when nothing else is stored) */
  | { kind: 'clear' }
  | { kind: 'set'; body: NarrationVoiceBody; pinnedDefault?: string }
  /** the change cannot be written (an instruction or language with no voice and no known default) */
  | { kind: 'blocked' }

const norm = (s: string) => s.trim()

/**
 * What to save for the narration voice. Three rules keep it from changing what the user did not change:
 * - it compares the draft with the project **as it was when the dialog opened** (`base`), after the same trimming on
 *   both sides, and only a field the user actually changed is taken from the draft;
 * - every other field is taken from the project **as it is now** (`live`), so a change made elsewhere while the dialog
 *   was open is not written back over; the speed, which this dialog does not edit, always comes from there;
 * - choosing the default voice is not clearing: the speed, instruction and language that are stored stay. With the
 *   model's default voice known it is written out as the voice (the dialog says so); with nothing else stored it is the
 *   same as no voice and the field is cleared; otherwise it cannot be written and the dialog says why.
 */
export function voiceOutcome(
  base: Project,
  live: Project,
  draft: VoiceDraft,
  active: { providerConfigId: string; defaultVoice?: string } | undefined,
): VoiceOutcome {
  if (draft.clearAll) return live.narrationVoice ? { kind: 'clear' } : { kind: 'none' }
  const before = draftOfVoice(base.narrationVoice)
  const dv = draft.voice === OTHER ? '' : norm(draft.voice)
  const voiceTouched = dv !== before.voice
  const insTouched = norm(draft.instructions) !== before.instructions
  const langTouched = norm(draft.language) !== before.language
  if (!voiceTouched && !insTouched && !langTouched) return { kind: 'none' }

  const now = live.narrationVoice
  const voice = voiceTouched ? dv : (now?.voice.trim() ?? '')
  const instructions = insTouched ? norm(draft.instructions) : (now?.instructions?.trim() ?? '')
  const language = langTouched ? norm(draft.language) : (now?.language?.trim() ?? '')
  const speed = now?.speed

  let chosen = voice
  let pinnedDefault: string | undefined
  if (chosen === '') {
    if (instructions === '' && language === '' && speed === undefined)
      return now ? { kind: 'clear' } : { kind: 'none' }
    if (!active?.defaultVoice) return { kind: 'blocked' }
    chosen = active.defaultVoice
    pinnedDefault = active.defaultVoice
  }
  if (!active) return { kind: 'none' }
  return {
    kind: 'set',
    pinnedDefault,
    body: {
      providerConfigId: active.providerConfigId,
      voice: chosen,
      ...(speed !== undefined ? { speed } : {}),
      ...(instructions ? { instructions } : {}),
      ...(language ? { language } : {}),
    },
  }
}
