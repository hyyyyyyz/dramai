import type { TFunction } from 'i18next'
import type { Project } from '@dramai/api'

/** 风格 · 竖屏 9:16 —— 侧栏项目卡和概览副标题。 */
export function projectMeta(project: Pick<Project, 'style' | 'aspectRatio'>, t: TFunction): string {
  const parts: string[] = []
  if (project.style.source !== 'none' && project.style.label) parts.push(project.style.label)
  parts.push(t(`aspect.${project.aspectRatio}`))
  return parts.join(' · ')
}
