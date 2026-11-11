// @dramai/ui — 共享 UI 包的公共入口。
// 样式与品牌资源通过子路径导出：
//   import '@dramai/ui/styles/globals.css'
//   @dramai/ui/brand/*：品牌资源（图形标、字标、favicon、应用图标、README 横幅、社交分享图）

export { cn } from './lib/cn'

export { Badge, type BadgeProps } from './primitives/badge'
export { Button, type ButtonProps } from './primitives/button'
export { buttonVariants } from './primitives/button-variants'
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './primitives/card'
export { Input } from './primitives/input'
export { Label } from './primitives/label'
export { Modal, type ModalProps } from './primitives/modal'
export { Select } from './primitives/select'
export { Textarea } from './primitives/textarea'

export { BrandMark } from './brand/BrandMark'
export { Wordmark } from './brand/Wordmark'
export { GithubIcon } from './brand/GithubIcon'
