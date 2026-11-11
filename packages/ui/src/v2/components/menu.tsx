import {
  useEffect,
  useRef,
  type ComponentProps,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { cn } from '../lib/cn'
import type { Placement } from '../lib/use-anchored'
import { Popover } from './popover'

export interface MenuItem {
  key: string
  label: ReactNode
  icon?: ReactNode
  onSelect: () => void
  disabled?: boolean
  /** 破坏性操作：危险色，且通常排在最后。 */
  danger?: boolean
}

export interface MenuProps {
  trigger: ReactElement<Record<string, unknown>>
  items: (MenuItem | 'separator')[]
  placement?: Placement
  'aria-label'?: string
}

/** 菜单：镜头的更多操作、服务商预设。方向键移动，Enter / 空格选择，Esc 关闭。 */
export function Menu({ trigger, items, placement = 'bottom-end', ...rest }: MenuProps) {
  return (
    <Popover trigger={trigger} placement={placement} role="menu" aria-label={rest['aria-label']}>
      {(close) => <MenuList items={items} close={close} />}
    </Popover>
  )
}

function MenuList({ items, close }: { items: MenuProps['items']; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const enabled = () =>
    Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [],
    )

  useEffect(() => {
    enabled()[0]?.focus()
  }, [])

  const onKeyDown = (e: KeyboardEvent) => {
    const list = enabled()
    const i = list.indexOf(document.activeElement as HTMLButtonElement)
    const go = (target: HTMLElement | undefined) => {
      e.preventDefault()
      target?.focus()
    }
    if (e.key === 'ArrowDown') go(list[(i + 1) % list.length])
    else if (e.key === 'ArrowUp') go(list[(i - 1 + list.length) % list.length])
    else if (e.key === 'Home') go(list[0])
    else if (e.key === 'End') go(list[list.length - 1])
    else if (e.key === 'Tab') close()
  }

  return (
    <div ref={ref} onKeyDown={onKeyDown} className="flex flex-col">
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={`sep-${i}`} role="separator" className="my-1 h-px bg-border" />
        ) : (
          <MenuItemButton
            key={item.key}
            danger={item.danger}
            disabled={item.disabled}
            onClick={() => {
              close()
              item.onSelect()
            }}
          >
            {item.icon}
            {item.label}
          </MenuItemButton>
        ),
      )}
    </div>
  )
}

function MenuItemButton({
  danger,
  className,
  ...props
}: ComponentProps<'button'> & { danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-base',
        'transition-colors duration-(--duration-fast) ease-standard',
        'hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        danger ? 'text-danger' : 'text-foreground',
        className,
      )}
      {...props}
    />
  )
}
