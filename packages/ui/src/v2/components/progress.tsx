import type { ComponentProps } from 'react'
import { cva } from 'class-variance-authority'
import { cn } from '../lib/cn'

export interface ProgressProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** 0–max。不传且 indeterminate 为 false 时按 0 处理。 */
  value?: number
  max?: number
  /**
   * 不确定进度：一段 36% 宽的朱砂条在轨道上滑动。只用于「服务商在处理、没有精确进度」的任务（视频）。
   * reduce-motion 下改成静态半透明满条。整个系统唯一的循环动画。
   */
  indeterminate?: boolean
  /** 进度条的无障碍名称，必填（如「批量生成」）。 */
  'aria-label': string
}

/** 确定进度（批量 4/6）与不确定进度（视频任务）。4px 高。 */
export function Progress({
  value = 0,
  max = 100,
  indeterminate = false,
  className,
  ...props
}: ProgressProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={indeterminate ? undefined : max}
      aria-valuenow={indeterminate ? undefined : value}
      className={cn('relative h-1 overflow-hidden rounded-xs bg-surface-2', className)}
      {...props}
    >
      <div
        className={cn(
          'h-full rounded-xs bg-accent',
          indeterminate
            ? 'w-[36%] animate-busy-slide motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-50'
            : 'transition-[width] duration-(--duration-base) ease-standard',
        )}
        style={indeterminate ? undefined : { width: `${pct}%` }}
      />
    </div>
  )
}

/**
 * 装饰性的不确定进度条（aria-hidden），贴在别的元素边缘表示「正在处理」。
 * 不单独暴露给使用方：需要语义的地方用带 aria-label 的 Progress。
 */
export function BusyBar({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('h-0.5 overflow-hidden bg-surface-2', className)}>
      <div className="h-full w-[36%] animate-busy-slide bg-accent motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-50" />
    </div>
  )
}

const segmentVariants = cva('h-1.5 flex-1 rounded-[1px]', {
  variants: {
    tone: {
      none: 'bg-surface-2 shadow-[inset_0_0_0_1px_var(--border)]',
      info: 'bg-info',
      success: 'bg-success',
      danger: 'bg-danger',
      accent: 'bg-accent',
    },
  },
  defaultVariants: { tone: 'none' },
})

export type SegmentTone = 'none' | 'info' | 'success' | 'danger' | 'accent'

export interface SegmentedProgressProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** 每一段是一个镜头：none 未开始 / info 图已生成 / success 视频已生成 / danger 失败 / accent 进行中。 */
  segments: SegmentTone[]
  /** 必填：用一句话说出各状态的数量，如「24 个镜头：8 个已出图，9 个已出视频，1 个失败」。颜色本身不传递含义。 */
  'aria-label': string
}

/** 分段进度：每段一个镜头，颜色表示该镜头走到哪一步（颜色之外必须有文字说明）。 */
export function SegmentedProgress({ segments, className, ...props }: SegmentedProgressProps) {
  return (
    <div role="img" className={cn('flex gap-0.5', className)} {...props}>
      {segments.map((tone, i) => (
        <i key={i} className={segmentVariants({ tone })} />
      ))}
    </div>
  )
}
