import type { Project } from '@dramai/api'
import { defaultVoiceState, voiceFit, voiceListKind } from './voice-model'

export type VoiceIssue = {
  project: Pick<Project, 'id' | 'name'>
  voice?: string
  /**
   * - `not_available`: the new model's list is closed and does not have the voice;
   * - `unlisted`: the list is open and does not name the voice;
   * - `unchecked`: the new model has no list to check against, so whether the stored voice works is not known here;
   * - `required`: the new model has a profile and no default voice, and the project has no voice.
   * None of these says it is fine: the pre-flight, which reads every profile and the address, is the one to say.
   */
  kind: 'not_available' | 'unlisted' | 'unchecked' | 'required'
}

type View = Parameters<typeof defaultVoiceState>[0]

/** The voice of each narrated project against the speech provider that was just made current. */
export function voiceIssues(
  projects: readonly Pick<Project, 'id' | 'name' | 'narrationDelivery' | 'narrationVoice'>[],
  next: View,
): VoiceIssue[] {
  const out: VoiceIssue[] = []
  const kind = voiceListKind(next.capability)
  for (const p of projects) {
    if (p.narrationDelivery !== 'tts') continue
    const voice = p.narrationVoice?.voice?.trim()
    if (!voice) {
      // only when the server says the model has no default: for a model that doesn't say, nothing is claimed
      if (defaultVoiceState(next) === 'none') out.push({ project: p, kind: 'required' })
      continue
    }
    const fit = voiceFit(next.capability, voice)
    if (fit === 'not_in_list') out.push({ project: p, voice, kind: 'not_available' })
    else if (fit === 'unlisted') out.push({ project: p, voice, kind: 'unlisted' })
    else if (kind === 'none') out.push({ project: p, voice, kind: 'unchecked' })
  }
  return out
}
