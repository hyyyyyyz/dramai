import type { ComponentProps, CSSProperties, ReactNode } from 'react'
import { AlertTriangle, Clock, Play } from 'lucide-react'
import { cn } from '../lib/cn'
import { iconProps } from '../lib/icon'
import { BusyBar } from './progress'

export type FrameRatio = '9:16' | '16:9' | '1:1'

const ratioClass: Record<FrameRatio, string> = {
  '9:16': 'aspect-[9/16]',
  '16:9': 'aspect-video',
  '1:1': 'aspect-square',
}

/** 状态覆盖层：图上盖半透明层，写明状态；颜色不单独传递含义。 */
export type FrameStatus = 'queued' | 'running' | 'failed'

export interface FrameProps extends ComponentProps<'div'> {
  ratio?: FrameRatio
  /** 图片地址；不传则是虚线空框（待生图）。 */
  src?: string
  alt?: string
  /** 视频已生成：显示播放键与时长（如 "0:05"）。 */
  duration?: string
  /** 生成中 / 排队 / 失败：盖覆盖层。 */
  status?: FrameStatus
  /** 覆盖层文字，例如「生成中」「排队中」「生成失败」。 */
  statusLabel?: ReactNode
  /** 版本角标，例如 "v3"。 */
  version?: string
  /** 空框里的占位内容（图标）。 */
  placeholder?: ReactNode
}

// 进行中不放图标：旋转的图标是第二种循环动画，状态靠文字和底边的不确定进度条表达
const statusIcon = { queued: Clock, failed: AlertTriangle } as const

/**
 * 画幅容器：按 aspect-ratio 渲染 9:16 / 16:9 / 1:1。
 * 空框是虚线，有图是 cover 填充，视频已生成多一个播放键与时长，生成中 / 排队 / 失败盖覆盖层。
 */
export function Frame({
  ratio = '9:16',
  src,
  alt = '',
  duration,
  status,
  statusLabel,
  version,
  placeholder,
  className,
  children,
  ...props
}: FrameProps) {
  const empty = !src
  const StatusIcon = status && status !== 'running' ? statusIcon[status] : null
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-sm border bg-sunken',
        ratioClass[ratio],
        empty
          ? 'flex items-center justify-center border-dashed border-border-strong bg-transparent text-subtle'
          : 'border-transparent',
        className,
      )}
      {...props}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          className="absolute inset-0 size-full object-cover"
          draggable={false}
        />
      ) : (
        placeholder
      )}
      {version && (
        <span className="absolute top-1 left-1 rounded-xs bg-black/60 px-1 font-mono text-[11px] leading-4 text-white">
          {version}
        </span>
      )}
      {duration && (
        <>
          <span
            aria-hidden
            className="absolute top-1/2 left-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white"
          >
            <Play size={14} fill="currentColor" strokeWidth={0} className="ml-0.5" />
          </span>
          <span className="absolute right-1 bottom-1 rounded-xs bg-black/60 px-1 font-mono text-[11px] leading-4 text-white">
            {duration}
          </span>
        </>
      )}
      {status && (
        <div
          role="status"
          className={cn(
            'absolute inset-0 flex flex-col items-center justify-center gap-2 p-2 text-center text-xs leading-snug text-white',
            status === 'failed'
              ? 'bg-[oklch(0.22_0.07_12/0.82)]'
              : 'bg-[oklch(0.12_0.005_70/0.72)]',
          )}
        >
          {StatusIcon && <StatusIcon {...iconProps} size={18} aria-hidden />}
          {statusLabel}
          {/* 进行中：服务商在处理、没有精确进度，用系统里唯一的循环动画——不确定进度条，贴在画框底边 */}
          {status === 'running' && <BusyBar className="absolute inset-x-0 bottom-0 bg-white/20" />}
        </div>
      )}
      {children}
    </div>
  )
}

// 四个角各一条横、一条竖：10px 长、1.5px 粗。颜色取自 --cm。
const MARKS = (['0 0', '100% 0', '0 100%', '100% 100%'] as const)
  .flatMap((pos) => [`${pos} / 10px 1.5px`, `${pos} / 1.5px 10px`])
  .map((p) => `linear-gradient(var(--cm), var(--cm)) ${p} no-repeat`)
  .join(', ')

export interface CropMarksProps extends ComponentProps<'div'> {
  /** 角标颜色，默认朱砂（--cm 可被覆盖）。 */
  color?: string
}

/**
 * 取景框角标：包住 Frame 的容器上加四个 L 形角标（10px 长、1.5px 粗，向外 6px）。
 * 品牌的签名细节，只标记「当前」的那一个画面，不要滥用。
 */
export function CropMarks({ color, className, style, children, ...props }: CropMarksProps) {
  return (
    <div
      className={cn('relative [--cm:var(--accent)]', className)}
      style={color ? ({ ...style, '--cm': color } as CSSProperties) : style}
      {...props}
    >
      {children}
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-1.5"
        style={{ background: MARKS }}
      />
    </div>
  )
}
