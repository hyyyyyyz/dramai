import { cva, type VariantProps } from 'class-variance-authority'

/**
 * 按钮。朱砂实心只给主操作；文字用墨色（白字压在朱砂上只有 3.97，不够 4.5）；没有阴影、没有发光。
 * 尺寸 sm 28 / md 36 / lg 44 / icon 32；触屏（≤800px）md 与 icon 加到 40。
 */
export const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent font-medium select-none',
    'transition-colors duration-(--duration-fast) ease-standard',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-foreground hover:bg-accent-hover disabled:hover:bg-accent',
        secondary:
          'border-border-strong bg-surface text-foreground hover:bg-surface-2 disabled:hover:bg-surface',
        ghost: 'text-foreground hover:bg-surface-2 disabled:hover:bg-transparent',
        // 危险：描边加危险色文字；实心危险按钮只留给弹窗里的最终确认（confirm）
        danger: 'border-danger text-danger hover:bg-danger-soft disabled:hover:bg-transparent',
        'danger-solid': 'bg-danger text-background hover:opacity-90',
        link: 'h-auto rounded-sm px-0 text-accent-text underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-7 px-3 text-sm',
        md: 'h-9 px-4 text-base max-[800px]:h-10',
        lg: 'h-11 px-6 text-md',
        icon: 'size-8 p-0 max-[800px]:size-10',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export type ButtonVariants = VariantProps<typeof buttonVariants>
