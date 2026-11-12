import { useCallback, useEffect, useRef, type ComponentProps } from 'react'
import { Drawer as UiDrawer, Modal as UiModal } from '@dramai/ui/v2'

/**
 * 对 @dramai/ui/v2 的 Modal / Drawer 做一层薄包装：把 onClose 稳定下来。
 * 组件库里弹层的焦点逻辑依赖 onClose 的引用：调用方每次渲染传进来一个新函数，它就重新记一次“打开前的焦点”，
 * 记到的是弹层里面的元素，关闭后焦点就回不到触发它的按钮。这里让引用永远不变，焦点才会正确归还。
 * 组件库修好之后这个包装可以删掉。
 */
function useStableClose(onClose: () => void) {
  const latest = useRef(onClose)
  useEffect(() => {
    latest.current = onClose
  })
  return useCallback(() => latest.current(), [])
}

export function Modal(props: ComponentProps<typeof UiModal>) {
  return <UiModal {...props} onClose={useStableClose(props.onClose)} />
}

export function Drawer(props: ComponentProps<typeof UiDrawer>) {
  return <UiDrawer {...props} onClose={useStableClose(props.onClose)} />
}
