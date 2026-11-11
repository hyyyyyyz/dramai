// @dramai/ui/v2 —— 设计系统 v2 的组件入口（依据 design/DESIGN.md）。
// 样式：  import '@dramai/ui/v2/styles.css'   （Tailwind + 字体 + token + 元素默认值）
//         或分开：theme.css（只有 token）、fonts.css（只有字体）
// 与旧入口 `@dramai/ui` 互不影响，但不要在同一个应用里同时加载新旧两套样式。

export { cn } from './lib/cn'
export { iconProps, iconPropsSm, iconPropsLg } from './lib/icon'
export { useControllable } from './lib/use-controllable'

export { BrandMark } from './brand/BrandMark'
export { Wordmark } from './brand/Wordmark'

export { Button, type ButtonProps } from './components/button'
export { buttonVariants } from './components/button-variants'
export { IconButton, type IconButtonProps } from './components/icon-button'
export { Pill, type PillProps } from './components/pill'
export { Chip, type ChipProps } from './components/chip'
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/card'
export { Field, Hint, Label, type FieldProps } from './components/field'
export { Input, type InputProps } from './components/input'
export { Textarea, type TextareaProps } from './components/textarea'
export { Select, type SelectProps } from './components/select'
export { Switch, type SwitchProps } from './components/switch'
export { Checkbox, type CheckboxProps } from './components/checkbox'
export { Modal, Drawer, type ModalProps, type DrawerProps } from './components/overlay'
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
} from './components/segmented-control'
export { Tabs, TabsContent, TabsList, TabsTrigger, type TabsProps } from './components/tabs'
export {
  Progress,
  SegmentedProgress,
  type ProgressProps,
  type SegmentedProgressProps,
  type SegmentTone,
} from './components/progress'
export { Tooltip, type TooltipProps } from './components/tooltip'
export { Popover, type PopoverProps } from './components/popover'
export { Menu, type MenuItem, type MenuProps } from './components/menu'
export { ToastProvider } from './components/toast'
export { useToast, type ToastOptions } from './components/toast-context'
export { Notice, type NoticeProps } from './components/notice'
export { EmptyState, type EmptyStateProps } from './components/empty-state'
export { Skeleton } from './components/skeleton'
export {
  CopyField,
  SecretField,
  type CopyFieldProps,
  type SecretFieldProps,
} from './components/copy-field'
export {
  Frame,
  CropMarks,
  type FrameProps,
  type FrameRatio,
  type FrameStatus,
  type CropMarksProps,
} from './components/frame'
