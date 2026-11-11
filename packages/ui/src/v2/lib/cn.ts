import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// v2 在 theme.css 里自定义了字号（title-sm…）、阴影（pop）与动画名，告诉 tailwind-merge，
// 否则 `text-title-sm` 会被当成颜色，和 `text-foreground` 互相吃掉。
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['xs', 'sm', 'base', 'md', 'title-sm', 'title-md', 'title-lg', 'title-xl'] },
      ],
      shadow: [{ shadow: ['pop'] }],
      animate: [
        {
          animate: [
            'busy-slide',
            'fade-in',
            'pop-in',
            'slide-in-right',
            'slide-in-bottom',
            'toast-in',
          ],
        },
      ],
    },
  },
})

/** 合并 Tailwind 类名并解决冲突。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
