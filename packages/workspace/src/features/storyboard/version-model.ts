import type { MediaSlot } from '@dramai/api'

/** 版本号：按版本在列表里的先后，从 1 起。 */
export const versionNumber = (
  slot: MediaSlot,
  versionId: string | null | undefined,
): number | undefined => {
  const i = slot.versions.findIndex((v) => v.id === versionId)
  return i < 0 ? undefined : i + 1
}
