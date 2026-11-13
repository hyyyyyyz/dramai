import type { MediaSlot } from '@dramai/api'

/** 版本号：按版本在列表里的先后，从 1 起。 */
export const versionNumber = (
  slot: MediaSlot,
  versionId: string | null | undefined,
): number | undefined => {
  const i = slot.versions.findIndex((v) => v.id === versionId)
  return i < 0 ? undefined : i + 1
}

type MediaVersion = MediaSlot['versions'][number]
export type UsedReferences = NonNullable<MediaVersion['usedReferences']>

/**
 * The references a video was made with, as names in the order they were sent: a character or place by its name (and
 * its form, when it has one), the shot image by its role. The names are the user's own words and shown as they are.
 */
export function usedReferenceNames(
  used: UsedReferences,
  roleLabel: (role: UsedReferences['references'][number]['role']) => string,
): string[] {
  return used.references.map((r) => {
    const name = r.assetName?.trim()
    if (!name) return roleLabel(r.role)
    return r.variantName ? `${name} (${r.variantName})` : name
  })
}
