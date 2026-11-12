import type { StyleChoice } from '@dramai/api'

export interface StylePick {
  templateId?: string
  custom: string
}

/** 选择结果 → 创建 / 更新项目的 style 字段。 */
export function toStyleChoice(pick: StylePick): StyleChoice {
  if (pick.templateId) return { source: 'template', templateId: pick.templateId }
  const custom = pick.custom.trim()
  if (custom) return { source: 'custom', description: custom }
  return { source: 'none' }
}
