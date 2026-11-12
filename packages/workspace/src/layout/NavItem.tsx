import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { cn } from '@dramai/ui/v2'

export function NavItem({
  to,
  end,
  icon,
  children,
  count,
  hot,
  disabled,
}: {
  to: string
  end?: boolean
  icon: ReactNode
  children: ReactNode
  count?: number
  hot?: boolean
  disabled?: boolean
}) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-disabled={disabled || undefined}
      className={cn(
        'relative flex h-9 items-center gap-3 rounded-md px-3 text-muted-foreground',
        'transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-2 hover:text-foreground',
        'aria-[current=page]:bg-surface-2 aria-[current=page]:font-medium aria-[current=page]:text-foreground',
        'aria-[current=page]:before:absolute aria-[current=page]:before:inset-y-2 aria-[current=page]:before:-left-3 aria-[current=page]:before:w-[3px] aria-[current=page]:before:rounded-r-xs aria-[current=page]:before:bg-accent',
      )}
    >
      <span aria-hidden className="grid flex-none place-items-center">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined && count > 0 && (
        <span
          className={cn('font-mono text-xs tabular-nums', hot ? 'text-accent-text' : 'text-subtle')}
        >
          {count}
        </span>
      )}
    </NavLink>
  )
}
