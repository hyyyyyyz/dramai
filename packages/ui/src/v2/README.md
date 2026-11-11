# @dramai/ui v2：设计系统

依据 `design/DESIGN.md`（不在仓库里，由设计会话维护）。和旧入口 `@dramai/ui` 并行存在，互不影响。
旧工作台继续用旧入口；新的 `packages/workspace` 重写时只用 v2。

## 使用

```css
/* 应用的入口样式。一体入口 = Tailwind + 字体 + token + 元素默认值 */
@import '@dramai/ui/v2/styles.css';
```

```tsx
import { Button, Field, Input, Modal, Pill, ToastProvider } from '@dramai/ui/v2'
```

分开引入（应用自己已经 `@import 'tailwindcss'` 时）：

| 入口                       | 内容                                                            |
| -------------------------- | --------------------------------------------------------------- |
| `@dramai/ui/v2/theme.css`  | token（深浅两套变量、`@theme`、动画），含对 v2 源码的 `@source` |
| `@dramai/ui/v2/fonts.css`  | 自托管字体（Inter、JetBrains Mono、Noto Sans SC 700）           |
| `@dramai/ui/v2/base.css`   | `body`、标题字体、焦点环                                        |
| `@dramai/ui/v2/styles.css` | 以上全部 + `@import 'tailwindcss'`                              |

**不要在同一个应用里同时加载新旧两套样式**：token 同名、值不同。

## 主题

- `<html data-theme="dark|light">` 显式指定；没有 `data-theme` 时跟随系统（没有 JS 也正确），系统没有偏好是深色。
- 局部容器也可以写 `data-theme`（并排预览用）。
- 记住用户选择由应用负责（`localStorage` 读写要包 `try/catch`）。

## 字体

不请求任何外部域名。`fonts.css` 里的字体文件由打包器处理：Inter 与 JetBrains Mono 是可变字体，
Noto Sans SC 只有 700 一个字重（只给标题 `font-display`），101 片 woff2 按 `unicode-range` 切分，浏览器只下载页面用到的。
桌面端打包时把整个 `assets/` 里的 woff2 一起带上即可（约 2.4 MB）。

升级 `@fontsource/noto-sans-sc` 后重新生成：`pnpm --filter @dramai/ui build:fonts`。

## 约定

- 颜色只用语义 token（`bg-surface`、`text-muted-foreground`、`border-border`…），不写具体色值。
- 朱砂 `accent` 只做图形与实心主按钮；文字与链接用 `text-accent-text`；压在朱砂上的字用 `text-accent-foreground`（墨）。
- 标题 `font-display font-bold`；等宽 `font-mono`；字号 `text-xs/sm/base/md/title-sm/md/lg/xl`。
- 图标统一 lucide-react，线宽 1.5，界面内 16px：`<Icon {...iconProps} />`。
- 过渡只写具体属性，用 `duration-(--duration-fast) ease-standard`。

## 预览

```bash
pnpm --filter @dramai/ui dev      # http://localhost:5180，?theme=light|dark|system，?compare=1 并排
pnpm --filter @dramai/ui build    # 只验证预览页能构建
pnpm --filter @dramai/ui test
```
