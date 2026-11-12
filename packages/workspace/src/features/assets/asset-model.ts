import type { AssetKind, MediaSlot } from '@dramai/api'

export const ASSET_KINDS: readonly AssetKind[] = ['character', 'location', 'prop', 'costume']

/** 当前版本的文件路径（没有当前版本就是 undefined）。 */
export const sheetPath = (slot: MediaSlot) =>
  slot.versions.find((v) => v.id === slot.currentVersionId)?.file.path
