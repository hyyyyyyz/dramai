import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'
import { useControllable } from '../lib/use-controllable'

export interface SwitchProps extends Omit<ComponentProps<'button'>, 'onChange' | 'role'> {
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

/** 开关：role="switch"。开启态是朱砂底（图形用 accent），滑块是墨色。 */
export function Switch({
  checked,
  defaultChecked = false,
  onCheckedChange,
  className,
  onClick,
  ...props
}: SwitchProps) {
  const [on, setOn] = useControllable(checked, defaultChecked, onCheckedChange)
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-state={on ? 'on' : 'off'}
      onClick={(e) => {
        onClick?.(e)
        if (!e.defaultPrevented) setOn(!on)
      }}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-border-strong bg-surface-2 p-0.5',
        'transition-colors duration-(--duration-base) ease-standard',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=on]:border-accent data-[state=on]:bg-accent',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'block size-3.5 rounded-full bg-muted-foreground',
          'transition-transform duration-(--duration-base) ease-standard',
          on && 'translate-x-4 bg-accent-foreground',
        )}
      />
    </button>
  )
}
