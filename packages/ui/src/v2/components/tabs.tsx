import {
  createContext,
  useContext,
  useId,
  useRef,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { cn } from '../lib/cn'
import { useControllable } from '../lib/use-controllable'

interface TabsContextValue {
  value: string
  setValue: (v: string) => void
  baseId: string
}
const TabsContext = createContext<TabsContextValue | null>(null)
function useTabs() {
  const ctx = useContext(TabsContext)
  if (!ctx) throw new Error('Tabs sub-components must be rendered inside <Tabs>')
  return ctx
}

export interface TabsProps extends Omit<ComponentProps<'div'>, 'defaultValue' | 'onChange'> {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
}

/** 标签页：任务面板的筛选、设置内的分区。当前项是一条朱砂细线，不是填充。 */
export function Tabs({ value, defaultValue = '', onValueChange, ...props }: TabsProps) {
  const [current, setCurrent] = useControllable(value, defaultValue, onValueChange)
  const baseId = useId()
  return (
    <TabsContext.Provider value={{ value: current, setValue: setCurrent, baseId }}>
      <div {...props} />
    </TabsContext.Provider>
  )
}

export function TabsList({ className, onKeyDown, ...props }: ComponentProps<'div'>) {
  const ref = useRef<HTMLDivElement>(null)
  const handle = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e)
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End']
    if (!keys.includes(e.key)) return
    const tabs = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') ?? [],
    )
    if (tabs.length === 0) return
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % tabs.length
        : e.key === 'ArrowLeft'
          ? (i - 1 + tabs.length) % tabs.length
          : e.key === 'Home'
            ? 0
            : tabs.length - 1
    e.preventDefault()
    tabs[next].focus()
    tabs[next].click()
  }
  return (
    <div
      ref={ref}
      role="tablist"
      onKeyDown={handle}
      className={cn('flex gap-1 border-b border-border', className)}
      {...props}
    />
  )
}

export interface TabsTriggerProps extends Omit<ComponentProps<'button'>, 'value'> {
  value: string
  /** 右侧的计数，等宽字体、次要色；needsAttention 时用 accent-text。 */
  count?: ReactNode
  needsAttention?: boolean
}

export function TabsTrigger({
  value,
  count,
  needsAttention,
  className,
  children,
  ...props
}: TabsTriggerProps) {
  const { value: current, setValue, baseId } = useTabs()
  const active = current === value
  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      aria-selected={active}
      aria-controls={`${baseId}-panel-${value}`}
      tabIndex={active ? 0 : -1}
      onClick={() => setValue(value)}
      className={cn(
        '-mb-px inline-flex h-10 items-center gap-2 border-b-2 border-transparent px-3 text-base text-muted-foreground',
        'transition-colors duration-(--duration-fast) ease-standard',
        'hover:text-foreground',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        active && 'border-accent font-medium text-foreground',
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined && (
        <span
          className={cn(
            'font-mono text-xs font-normal text-subtle',
            needsAttention && 'text-accent-text',
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
}

export function TabsContent({
  value,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'value'> & { value: string }) {
  const { value: current, baseId } = useTabs()
  if (current !== value) return null
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      tabIndex={0}
      className={cn('outline-none focus-visible:outline-2 focus-visible:outline-ring', className)}
      {...props}
    />
  )
}
