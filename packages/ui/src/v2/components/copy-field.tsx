import { useState, type ReactNode } from 'react'
import { Check, Copy, Lock } from 'lucide-react'
import { cn } from '../lib/cn'
import { iconProps } from '../lib/icon'
import { Button } from './button'

const box =
  'flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-border-strong bg-sunken px-3 font-mono text-sm'

export interface CopyFieldProps {
  value: string
  /** 复制成功后的回调（比如弹 toast）。 */
  onCopied?: () => void
  copyLabel?: string
  copiedLabel?: string
  className?: string
  'aria-label'?: string
}

/** 只读复制框：安装命令、本地服务地址。 */
export function CopyField({
  value,
  onCopied,
  copyLabel = '复制',
  copiedLabel = '已复制',
  className,
  ...rest
}: CopyFieldProps) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      onCopied?.()
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      /* 剪贴板不可用（非安全上下文）：保持原样，用户仍可手动选中 */
    }
  }
  return (
    <div className={cn('flex gap-2', className)}>
      <div className={cn(box, 'text-foreground')}>
        <span
          tabIndex={0}
          aria-label={rest['aria-label']}
          className="min-w-0 flex-1 truncate select-all"
        >
          {value}
        </span>
      </div>
      <Button variant="secondary" onClick={copy} aria-live="polite">
        {copied ? <Check {...iconProps} aria-hidden /> : <Copy {...iconProps} aria-hidden />}
        {copied ? copiedLabel : copyLabel}
      </Button>
    </div>
  )
}

export interface SecretFieldProps {
  /** 已保存的提示文字，例如「已保存，只能替换」。不显示真实值。 */
  status: ReactNode
  /** 右侧动作，例如「替换」按钮。 */
  action?: ReactNode
  className?: string
}

/** Key 的「已保存，只能替换」展示：值从不回显，只显示状态。 */
export function SecretField({ status, action, className }: SecretFieldProps) {
  return (
    <div className={cn('flex gap-2', className)}>
      <div className={cn(box, 'text-muted-foreground')}>
        <Lock {...iconProps} aria-hidden className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{status}</span>
      </div>
      {action}
    </div>
  )
}
