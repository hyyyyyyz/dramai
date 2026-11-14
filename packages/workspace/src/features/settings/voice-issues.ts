import type { Project } from '@dramai/api'
import { voiceFit, voiceListKind, voiceMismatch } from './voice-model'

export type VoiceIssue = {
  project: Pick<Project, 'id' | 'name'>
  voice?: string
  kind: 'from_another_service' | 'not_available' | 'unlisted' | 'required'
}

/** The voice of each narrated project against the speech provider that was just made current. */
export function voiceIssues(
  projects: readonly Pick<Project, 'id' | 'name' | 'narrationDelivery' | 'narrationVoice'>[],
  next: Parameters<typeof voiceListKind>[0],
  previous: Parameters<typeof voiceListKind>[0],
): VoiceIssue[] {
  const out: VoiceIssue[] = []
  for (const p of projects) {
    if (p.narrationDelivery !== 'tts') continue
    const voice = p.narrationVoice?.voice
    if (!voice) {
      if (!next?.defaultVoice) out.push({ project: p, kind: 'required' })
      continue
    }
    const mismatch = voiceMismatch(next, previous, voice)
    if (mismatch) out.push({ project: p, voice, kind: mismatch })
    else if (voiceFit(next, voice) === 'unlisted') out.push({ project: p, voice, kind: 'unlisted' })
  }
  return out
}
