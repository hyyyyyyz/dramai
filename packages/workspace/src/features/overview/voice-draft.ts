import type { Project } from '@dramai/api'

/** The marker of the voice select for "type another voice". */
export const OTHER = '__other__'

export type VoiceDraft = {
  voice: string
  instructions: string
  language: string
}

export const draftOfVoice = (v: Project['narrationVoice']): VoiceDraft => ({
  voice: v?.voice ?? '',
  instructions: v?.instructions ?? '',
  language: v?.language ?? '',
})

type NarrationVoiceBody = {
  providerConfigId: string
  voice: string
  speed?: number
  instructions?: string
  language?: string
}

/**
 * The narration voice to save: `undefined` = nothing changed, `null` = clear it, otherwise the value. A style
 * instruction or language hint needs a voice to go with it, so with none chosen the model's default voice is written
 * out; a model with no default voice cannot save those until a voice is chosen (see `voiceDraftProblem`).
 */
export function voiceBody(
  project: Project,
  draft: VoiceDraft,
  active: { providerConfigId: string; defaultVoice?: string } | undefined,
): NarrationVoiceBody | null | undefined {
  const voice = draft.voice === OTHER ? '' : draft.voice.trim()
  const before = draftOfVoice(project.narrationVoice)
  const same =
    voice === before.voice &&
    draft.instructions.trim() === before.instructions.trim() &&
    draft.language.trim() === before.language.trim()
  if (same) return undefined
  const extras = draft.instructions.trim() !== '' || draft.language.trim() !== ''
  if (voice === '' && !extras) return null
  if (!active) return undefined
  const chosen = voice || active.defaultVoice
  if (!chosen) return undefined
  return {
    providerConfigId: active.providerConfigId,
    voice: chosen,
    ...(project.narrationVoice?.speed !== undefined ? { speed: project.narrationVoice.speed } : {}),
    ...(draft.instructions.trim() ? { instructions: draft.instructions.trim() } : {}),
    ...(draft.language.trim() ? { language: draft.language.trim() } : {}),
  }
}

/**
 * What blocks saving the voice section. Only what cannot be saved at all: a style instruction or language hint needs a
 * voice to go with it, and a model with no default voice has none to fall back on. A text over the model's limit is
 * not here: whether that is refused is the server's pre-flight to say (it only refuses on the official address of a
 * known model), so the dialog reminds and still lets it be saved.
 */
export function voiceDraftProblem(
  draft: VoiceDraft,
  defaultVoice: string | undefined,
): 'voice_needed' | undefined {
  const voice = draft.voice === OTHER ? '' : draft.voice.trim()
  const extras = draft.instructions.trim() !== '' || draft.language.trim() !== ''
  if (voice === '' && extras && !defaultVoice) return 'voice_needed'
  return undefined
}
