import type { GenerateItem } from '@dramai/api'

export type BatchKind = 'shot_image' | 'shot_video' | 'shot_audio' | 'asset_sheet'

export interface BatchCandidate {
  /** 目标 id：镜头 id，或资产 id（变体设定图是 `资产id/形态名`）。 */
  shotId: string
  /** 本集内的镜头序号；资产没有序号。 */
  index?: number
  /** 一行的名字：镜头是“镜头 03 · 回廊”，资产是资产名。 */
  label: string
  thumb?: string
  /** 补充说明（比如“用指令修改”的那句指令），写在名字下面。 */
  note?: string
  /** 旁白配音：这个镜头的旁白有多少个字符，超长时说明用（字符数，按码点）。 */
  narrationChars?: number
  /** 请求里的目标。 */
  target: GenerateItem['target']
}

/** 与服务端的 targetId 一致：`<kind>:<id>`。 */
export const batchTargetId = (kind: BatchKind, id: string) => `${kind}:${id}`
