import type { CallOutput } from '@dramai/api'

type Capability = CallOutput<'providers.capability'>['capability']

/** 卡片收起时的一行小标签：从能力里挑几项最关键的。 */
export function capabilitySummary(
  c: Capability,
  t: (k: string, o?: Record<string, unknown>) => string,
): string[] {
  const out: string[] = []
  for (const [mode, s] of Object.entries(c.modes))
    if (s === 'supported') out.push(t(`capability.mode.${mode}`, { defaultValue: mode }))
  if (c.media !== 'audio') {
    if (c.refImages.support === 'supported' && c.refImages.value !== undefined)
      out.push(t('capability.refImagesChip', { n: c.refImages.value }))
    else if (c.refImages.support === 'unverified') out.push(t('capability.refImagesUnverified'))
  }
  if (c.media === 'video') {
    if (c.nativeAudio === 'supported') out.push(t('capability.nativeAudioChip'))
    else if (c.nativeAudio === 'unsupported') out.push(t('capability.noNativeAudioChip'))
  }
  return out
}
