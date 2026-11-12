import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { useControllable } from '../lib/use-controllable'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  icon?: ReactNode
  disabled?: boolean
  /** 图标按钮没有可见文字时必填。 */
  ariaLabel?: string
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[]
  value?: T
  defaultValue?: T
  onValueChange?: (value: T) => void
  /** 控件的无障碍名称，必填（如「画幅」）。 */
  'aria-label': string
  className?: string
}

/** 分段控件：互斥选一个（画幅 9:16 / 16:9 / 1:1、深浅色）。radiogroup，方向键切换。 */
export function SegmentedControl<T extends string>({
  options,
  value,
  defaultValue,
  onValueChange,
  className,
  ...rest
}: SegmentedControlProps<T>) {
  const [current, setCurrent] = useControllable<T | undefined>(
    value,
    defaultValue ?? options[0]?.value,
    onValueChange as ((v: T | undefined) => void) | undefined,
  )
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const move = (from: number, dir: 1 | -1) => {
    for (let step = 1; step <= options.length; step++) {
      const i = (from + dir * step + options.length * step) % options.length
      if (!options[i].disabled) {
        setCurrent(options[i].value)
        refs.current[i]?.focus()
        return
      }
    }
  }
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      move(i, 1)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      move(i, -1)
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={rest['aria-label']}
      className={cn(
        'inline-flex gap-0.5 rounded-md border border-border-strong bg-sunken p-0.5',
        className,
      )}
    >
      {options.map((o, i) => {
        const active = o.value === current
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.ariaLabel}
            tabIndex={active ? 0 : -1}
            disabled={o.disabled}
            onClick={() => setCurrent(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'inline-flex h-7 items-center gap-2 rounded-sm px-3 text-base text-muted-foreground',
              'transition-colors duration-(--duration-fast) ease-standard',
              'hover:text-foreground',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
              'disabled:cursor-not-allowed disabled:opacity-50',
              active &&
                'bg-surface-2 font-medium text-foreground shadow-[0_0_0_1px_var(--border-strong)]',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
