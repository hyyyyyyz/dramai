/**
 * 图标统一用 lucide-react，线宽 1.5，界面内 16px（密集处 14、独占一行的空状态 24）。
 * 为什么不用设计稿里的自绘图标：设计稿的 40 多个图标是 24px 网格、圆头圆角的线性图标，
 * 与 lucide 同一套画法，lucide 都能覆盖；用 lucide 的好处是旧工作台已经依赖它、可按需摇树、
 * 后续新增图标不用再手绘。统一线宽靠这里的 iconProps 保证，不要在组件里各写各的 strokeWidth。
 */
export const iconProps = { size: 16, strokeWidth: 1.5 } as const
export const iconPropsSm = { size: 14, strokeWidth: 1.5 } as const
export const iconPropsLg = { size: 24, strokeWidth: 1.5 } as const
